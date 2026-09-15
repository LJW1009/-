# html_program — 법규 최신화 프로그램 (브라우저 단일 파일 버전)

`streamlit_detre_flow.py`와 똑같은 기능(법규 변경 보고사항 Excel 생성,
보도자료 요약 PPT 생성)을 **Python/Node 설치 없이** 브라우저만으로 쓸 수
있게 만든 버전. `detre_flow/scripts/build_legal_sheet.py`,
`append_law.py`, `build_press_ppt.js`의 로직을 그대로 JavaScript로
이식했다.

## 사용자에게 전달하는 파일

저장소 루트의 **`law_update_program.html`** 딱 한 개. 더블클릭해서
크롬/엣지 등으로 열면 바로 동작한다. 서버·설치·인터넷 연결이 필요 없다
(라이브러리를 전부 파일 안에 내장했다). 업로드한 파일은 브라우저 밖으로
전혀 전송되지 않는다 — 모든 처리가 로컬에서 끝난다.

## 이 폴더의 파일 (소스)

| 파일 | 역할 |
|---|---|
| `shell.html` | HTML 뼈대 + CSS + UI 마크업 |
| `app.js` | 공용 유틸 + Excel 로직 (build_legal_sheet.py/append_law.py 이식) |
| `ppt.js` | PPT 로직 (build_press_ppt.js 이식, pptxgenjs 사용) |
| `ui.js` | 폼 렌더링 · 이벤트 바인딩 |
| `build.py` | 위 파일들 + pptxgenjs 번들 + 아이콘(base64)을 합쳐 `law_update_program.html`을 생성 |

## 재빌드 방법

로직을 수정했으면 다시 조립해야 한다.

```bash
cd detre_flow && npm install && cd ..   # pptxgen.bundle.js 준비 (최초 1회)
python3 html_program/build.py
```

## detre_flow 파이썬/Node 스크립트와의 차이

- **Excel**: JSZip으로 업로드된 xlsx를 브라우저 메모리에서 직접
  ZIP/XML 수정 (openpyxl 왕복 저장을 하지 않는다는 원칙은 동일하게 지킴).
  styles.xml 인덱스는 업로드 시점에 그 파일에서 바로 추출한다.
- **PPT**: `build_press_ppt.js`(3장 고정 구성)만 이식했다.
  `build_report_ppt.js`(블록 자유구성)는 포함하지 않았다 — 필요하면
  Node 버전을 계속 쓰거나 추가 이식을 요청할 것.
- `qa_layout.py`(PDF 렌더 기반 최종 검수)는 브라우저에서 LibreOffice를
  띄울 수 없어 이식하지 않았다. 도형 겹침·이탈 정도는 육안으로 확인.
- 원본 보존 검증(삭제된 파트/변경된 파트/도형 유지)은 페이지 안에서
  자동으로 수행해 결과를 보여준다.

## 검증한 내용

실제 원본 통합 보고서.xlsx(78시트)를 헤드리스 브라우저로 업로드해
신규 월 탭 생성·기존 탭 추가 두 경로 모두 실행 — 원본 100% 보존,
도형 유지, 변경 파트 개수까지 Python 버전과 동일하게 확인. PPT도
실제 pptxgenjs로 생성해 슬라이드 구조·텍스트가 Node 버전과 일치함을
확인했다.
