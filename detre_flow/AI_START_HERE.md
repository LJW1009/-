# 처음 여는 AI에게

이 zip은 대방건설 영업계획팀의 "법규 변경 보고사항(Excel)"과 "보도자료
요약(PPT)"을 만드는 파이프라인 전체다. 사용자가 이 파일들과 함께 PDF
보도자료(또는 법제처 신구조문대비표 텍스트)를 주면, 아래 순서로 실제
결과 파일을 만들어 줄 것.

## 0. 먼저 읽을 것

**`CLAUDE.md`를 전부 읽어라.** 하우스 서식(색상·폰트·좌표), 절대 하지
말아야 할 것(엑셀 openpyxl 왕복 저장 금지 등), spec.json 스키마, 검수
절차가 전부 그 안에 있다. 이 파일(AI_START_HERE.md)은 그 위에 얹는
"콜드 스타트 체크리스트"일 뿐, CLAUDE.md를 대체하지 않는다.

## 1. 코드 실행이 가능한 경우 (Claude Code 등)

사용자가 PDF를 주면:

1. PDF를 직접 읽고 이해해서(기계적 텍스트 추출이 아니라 실제로 내용을
   파악해서) 요약·비교표·인포그래픽 내용을 판단한다. `CLAUDE.md`의
   "작성 원칙"(수치는 원문 확인 후 기재, 출처 페이지 명기, 1항목=1결론
   등)을 따른다.
2. `spec/` 폴더의 실제 예시들(특히 `legal_2026-08.json`,
   `20260715_기본형건축비_비정기고시.json`,
   `20260803_부동산세제합리화.json`)을 참고해 같은 스키마로 spec.json을
   작성한다.
   - PPT: 3장 고정이면 `meta/summary/changes/timeline/opinion/infographic`
     구조, 자유구성이면 `meta/slides[].blocks[]` 구조.
   - Excel: `yearMonth/department/laws[]` 구조 + `styles`(★ 아래 참고).
3. **Excel을 만들기 전에 반드시** 사용자가 준 원본 `통합 보고서.xlsx`에서
   styles.xml 인덱스를 직접 추출해 spec의 `"styles"` 키에 넣는다
   (CLAUDE.md의 추출 스니펫 사용, 또는 `html_program/app.js`의
   `extractCellStyles`/`pickStyle` 로직 참고). **하드코딩된 인덱스를
   그대로 믿지 말 것** — 파일마다, 저장할 때마다 달라진다.
4. 의존성 설치 후 스크립트 실행:
   ```bash
   cd detre_flow
   npm install
   pip install -r requirements.txt --break-system-packages
   node scripts/make_icons.js   # 최초 1회

   # PPT (자유구성, 실제 참고 PPT와 동일 형식)
   node scripts/build_report_ppt.js spec/생성한것.json 출력.pptx
   # 또는 PPT (3장 고정)
   node scripts/build_press_ppt.js spec/생성한것.json 출력.pptx
   python3 scripts/qa_layout.py 출력.pptx

   # Excel (신규 월)
   python3 scripts/build_legal_sheet.py 원본.xlsx spec/생성한것.json 출력.xlsx
   # 또는 (기존 탭에 추가)
   python3 scripts/append_law.py 원본.xlsx spec/생성한것.json 출력.xlsx
   ```
5. Excel은 반드시 "원본 보존 검증"(CLAUDE.md의 검증 스크립트, 또는
   삭제된 파트 0개·도형 유지·변경 파트 4개 이하 확인)을 통과한 뒤
   전달한다.
6. 완성된 xlsx/pptx 파일을 사용자에게 전달한다.

## 2. 코드 실행이 불가능한 경우 (일반 채팅)

PDF를 읽고 spec.json만 만들어서 사용자에게 텍스트로 준다. 사용자는 그걸
`law_update_program.html`(같이 전달된 브라우저 버전)의 "고급: spec.json
직접 입력"에 붙여넣으면 실제 파일이 나온다. Excel은 이 방식으로 못
만드니(styles 추출에 실제 파일이 필요) `law_update_program.html`의
Excel 탭에서 직접 입력하게 안내한다.

## 3. 참고용 — 이미 만들어져 있는 것

- `html_program/`: 이 파이프라인을 Python/Node 없이 브라우저에서 쓸 수
  있게 이식한 버전의 소스. 이 로직이 이미 검증된 정답이니, 자유구성 PPT
  블록 스키마나 Excel row 분류(head/same/change) 규칙이 헷갈리면
  `html_program/report_ppt.js`, `html_program/app.js`를 읽어라.
- `spec/20260813_주택신속공급_금융종합대책.json`: 실제 8.13 보도자료
  PDF를 사람이 요약해 만든 예시 — PDF → spec.json 변환 품질의 기준으로
  삼을 것.
