# 영업계획팀 법규·보도자료 자료 제작 파이프라인

대방건설 영업계획팀의 월간 법규 보고와 보도자료 요약 PPT를 만드는 도구 모음.
이 파일은 작업 전 반드시 읽는다. 특히 **"절대 하지 말 것"** 절은 과거에
실제로 파일을 망가뜨렸던 사례라 예외가 없다.

---

## 0. 절대 하지 말 것

### ❌ openpyxl로 워크북을 열고 다시 저장하지 말 것
`통합 보고서.xlsx`에는 2019~2020년분 시트 4개에 **도형(drawing)** 이 들어 있다.
openpyxl은 도형을 읽지 못해 `load_workbook()` → `save()` 왕복만으로 **영구 삭제**된다.
시트 78개 중 하나라도 잃으면 복구 불가.

→ 반드시 **ZIP/XML 직접 편집**. `scripts/build_legal_sheet.py`, `scripts/append_law.py`가
   이 방식으로 작성되어 있으니 그대로 쓴다.
   openpyxl은 **읽기 전용 검증**에만 쓴다.

### ❌ 스타일 인덱스를 하드코딩해 재사용하지 말 것
사용자가 엑셀에서 파일을 열고 저장할 때마다 `styles.xml`의 인덱스가 **전면 재배치**된다.
실제로 7월(`1014`) → 8월(`389`) → 재저장 후(`398`)로 매번 바뀌었다.

→ 작업 시작 전 **대상 파일에서 직접 추출**한다.
```bash
python3 -c "
import zipfile, re
from lxml import etree
NS='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z=zipfile.ZipFile('대상.xlsx')
wb=z.read('xl/workbook.xml').decode()
rels=dict(re.findall(r'Id=\"(rId\d+)\"[^>]*Target=\"([^\"]+)\"',
        z.read('xl/_rels/workbook.xml.rels').decode()))
for name in ['품의용 갑지','2026.08 영업계획팀']:
    rid=re.search(r'<sheet name=\"%s\"[^>]*r:id=\"(rId\d+)\"'%re.escape(name), wb).group(1)
    x=etree.fromstring(z.read('xl/'+rels[rid].lstrip('/')))
    print('==',name)
    for row in x.iter(NS+'row'):
        print(' r%s ht=%s'%(row.get('r'),row.get('ht')),
              {c.get('r'):c.get('s') for c in row.iter(NS+'c')})
"
```

### ❌ 사용자가 편집한 파일을 다시 생성하지 말 것
사용자는 받은 파일을 열어 **직접 손본다**. 실제 사례:
- 8월 주택법에서 조문 7건 중 **제57조만 남기고 삭제** (당사 관련 조문만 남기는 방침)
- 「관련없음」을 E열 → 별도 행으로 이동
- PPT에서 정정사항 슬라이드 삭제, 양도세 표 직접 보강

→ 수정 요청이 오면 **기존 파일을 열어 append/patch**한다.
   `scripts/append_law.py`(엑셀), `scripts/edit_report_ppt.py`(PPT)가 그 용도다.
   작업 후 반드시 "사용자 편집이 보존됐는지" 대조 검증할 것.

---

## 1. 두 갈래 파이프라인

```
[A] 법규 변경 보고사항 (Excel)       [B] 보도자료 요약 (PPT)
법제처 신구조문 붙여넣기              보도자료 PDF
        ↓                                   ↓
   legal_*.json                       ingest_pdf.py
        ↓                                   ↓
 build_legal_sheet.py (신규 월)      spec.json (요약은 사람이 판단)
 append_law.py        (기존에 추가)         ↓
        ↓                            build_press_ppt.js  (3장 고정)
  당월 탭 + 품의용 갑지 동시 갱신      build_report_ppt.js (블록 자유구성)
                                            ↓
                                      qa_layout.py (자동 검수)
```

---

## 2. [A] 법규 변경 보고사항

### 규칙
- 당월 `YYYY.MM 영업계획팀` 탭과 **`품의용 갑지` 탭 2개를 항상 함께** 갱신
- 갑지는 당월 내용의 6pt 축약 인쇄본 (월별 탭은 12.1pt)
- 일부개정이라도 당사와 무관하면 **「당사와 관련없음」** 표기
- 당월 탭은 `품의용 갑지` 바로 뒤(인덱스 1)에 삽입

### 실행
```bash
# 신규 월 탭 생성 (2개 탭 모두 새로 작성)
python3 scripts/build_legal_sheet.py 원본.xlsx spec/legal_2026-09.json 출력.xlsx

# 이미 만든 탭에 법령 추가 / 개정이유 교체
python3 scripts/append_law.py 원본.xlsx spec/append_2026-08_시행령.json 출력.xlsx
```

### 조문 행 분류 (`rows[].kind`)
| kind | 변경전(C) | 변경 후(D) | 용도 |
|---|---|---|---|
| `head` | 남색 볼드 `151594` | 동일 | 조문 표제행 |
| `same` | 회색 `444444` | 동일 | `(생 략)` / `(현행과 같음)` |
| `change` | 빨강 `FF0000` | 파랑 `0000CD` | 실제 개정 조문 |

`<신 설>`은 `change`의 before에 넣는다.
※ 사용자가 표제행도 `same`으로 쓰는 경우가 있으니 **대상 파일의 기존 블록을 먼저 확인**할 것.

### 열 구성
| 열 | 너비 | 내용 |
|---|---|---|
| A | 17.25 | 통보부서 (본문 전체 세로 병합) |
| B | 31.75 | 법률명칭 + 시행일·법령번호 (블록별 병합) |
| C | 94.125 | 변경전 |
| D | 96.375 | 변경 후 |

품의용 갑지는 A 2.25 / B 10.25 / C·D 35.75.

---

## 3. [B] 보도자료 요약 PPT

### 실행
```bash
node scripts/make_icons.js                          # 최초 1회 (아이콘 PNG 14종)
python3 scripts/ingest_pdf.py 보도자료.pdf work/     # 텍스트·이미지·spec 뼈대
node scripts/build_press_ppt.js  spec/xxx.json 출력.pptx   # 3장 고정 구성
node scripts/build_report_ppt.js spec/yyy.json 출력.pptx   # 블록 자유 구성
python3 scripts/qa_layout.py 출력.pptx               # 이탈·겹침·넘침 검수
```

### 하우스 서식 (10.833 × 7.5 in / 나눔바른고딕)
| 요소 | 값 |
|---|---|
| 표지 타이틀 바 | `003366`, 라운드 0.174, 흰 테두리 3pt, 그림자 45° |
| 표 머리행 | `002060` + 흰 글자 Bold |
| 표 본문 | **줄무늬 없음** (전부 흰 배경) |
| 요약 박스 | `FFFFCC`, 11pt Bold, 행간 150%, 말머리 ➊➋➌➍➎ |
| 의견 바 | 전폭 `FFFF99`, 11pt Bold, **왼쪽 정렬**, 각 줄 `- ` 접두 |
| 강조 | 파랑 `0000FF` / 노랑 형광 `FFFF00` |

### 마크업 (spec JSON 안)
| 표기 | 결과 |
|---|---|
| `[[텍스트]]` | 파랑 |
| `{{텍스트}}` | 파랑 + 노랑 형광 |
| `\n` | 셀·문단 내 줄바꿈 |

### build_report_ppt.js 블록 타입
`box`(요약) · `table` · `itemhead`(번호 배지 제목띠) · `compare`(현행→개정 카드)
· `info`(대비카드+항목카드) · `images` · `note`(출처 각주) · `bar`(하단 의견)

### 정부 인포그래픽 처리
**원본 이미지를 그대로 붙이지 않는다.** 내용을 읽고 하우스 테마(남색 계열)로
`itemhead` + `table` + `compare` 조합으로 다시 그린다.
원본 주황 계열 → 남색 `1F3864` 배지, 연남색 `EDF0F6` 띠로 대응.

---

## 4. 자동 맞춤 로직

한글 1em / 영숫자 0.52em로 실제 텍스트 폭을 계산한다(`emWidth`, `est_lines`).
- 요약 박스·표 행·의견 바 높이를 내용량에 맞춰 산정
- 남는 여백은 각 행에 균등 분배
- 넘치면 폰트를 0.5pt씩 자동 축소 (하한 8.5pt)
- 엑셀 행 높이도 동일 원리 (`n * pt * 1.32`)

**개정이유 문구를 교체하면 해당 행 높이를 반드시 재산정**한다.
안 하면 글자가 아래 행과 겹친다(실제 발생 사례).

---

## 5. 검수 절차 (매번)

### PPT
```bash
python /mnt/skills/public/pptx/scripts/office/validate.py 출력.pptx
python3 scripts/qa_layout.py 출력.pptx
```
`qa_layout.py`는 슬라이드 이탈·도형 겹침·렌더 PDF 기준 실제 넘침을 잡는다.
배경 카드 위 텍스트처럼 의도된 중첩(80% 이상 포함)은 걸러낸다.

### Excel
```bash
# ⚠ 검증본은 반드시 ZIP 수준으로 추출 — openpyxl로 만들면 pageSetup이 바뀌어
#    잘림 여부를 잘못 판정한다 (실제로 오판한 적 있음)
python3 - <<'PY'
import zipfile, re
zin=zipfile.ZipFile('출력.xlsx')
wb=zin.read('xl/workbook.xml').decode()
rels=dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"',
        zin.read('xl/_rels/workbook.xml.rels').decode()))
keep=['품의용 갑지','2026.08 영업계획팀']
sheets=re.findall(r'<sheet name="([^"]+)" sheetId="\d+"[^>]*r:id="(rId\d+)"/>', wb)
drop={'xl/'+rels[r].lstrip('/') for n,r in sheets if n not in keep}
for n,r in sheets:
    if n not in keep:
        wb=re.sub(r'<sheet name="%s" sheetId="\d+"[^>]*r:id="%s"/>'%(re.escape(n),r),'',wb)
wb=re.sub(r'<definedNames>.*?</definedNames>','',wb,flags=re.S)
with zipfile.ZipFile('verify.xlsx','w',zipfile.ZIP_DEFLATED) as zo:
    for i in zin.infolist():
        if i.filename in drop: continue
        zo.writestr(i, wb.encode() if i.filename=='xl/workbook.xml' else zin.read(i.filename))
PY
soffice --headless --convert-to pdf verify.xlsx
pdftotext verify.pdf - | tail   # 마지막 행까지 나오는지 확인
```

### 원본 보존 검증 (필수)
```bash
python3 -c "
import zipfile
a=zipfile.ZipFile('원본.xlsx'); b=zipfile.ZipFile('출력.xlsx')
na,nb=set(a.namelist()),set(b.namelist())
print('삭제:', sorted(na-nb) or '없음')
print('변경:', [n for n in sorted(na&nb) if a.read(n)!=b.read(n)])
print('드로잉 유지:', all(n in nb for n in na if 'drawing' in n))
"
```
정상이면 변경 파트는 **4개 이하**다 —
`[Content_Types].xml`, `workbook.xml`, `workbook.xml.rels`, 편집한 시트 XML.

---

## 6. 인쇄 설정

두 탭 모두 **A3 가로 1페이지**가 원칙.
```xml
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<pageSetup paperSize="8" fitToWidth="1" fitToHeight="1" orientation="landscape"/>
```
`fitToWidth="1"` **없으면 LibreOffice에서 하단이 잘린다.** `fitToHeight`만으로는 부족.
`scale` 속성은 fitToPage와 충돌하므로 제거한다.

---

## 7. 작성 원칙

- 수치·조문은 **반드시 원문 확인 후** 기재. 기억에 의존 금지
- 출처는 페이지 번호까지 명기 (예: 개편안 p.18~19)
- 현행 법령 인용은 조문 단위 (소득세법 시행령 §167조의3①2호 마목)
- 요약 항목은 **1항목 = 1결론**, 5개 이내. 근거·단서는 문장 뒤에
- 의견 바는 시장 영향 판단 1문장 + 전망/실행 1문장
- 확정 전 사항은 "'27.2월 정기 시행령 개정 시 확정" 같은 단서를 반드시 붙인다

---

## 8. 의존성

```bash
npm install pptxgenjs image-size react react-dom react-icons sharp
pip install openpyxl lxml python-pptx --break-system-packages
# LibreOffice(soffice), pdftotext, pdftoppm 필요
```
