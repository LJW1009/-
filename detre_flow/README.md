# detre_flow — 영업계획팀 자료 제작 파이프라인

## 빠른 시작

```bash
npm install
pip install -r requirements.txt --break-system-packages
node scripts/make_icons.js          # 아이콘 PNG 생성 (최초 1회)
```

## 폴더

```
detre_flow/
├─ CLAUDE.md        ← Claude Code가 자동으로 읽는 작업 지침 (필독)
├─ FLOW.md          ← 업무 흐름 문서 (사람용)
├─ scripts/         ← 생성·편집·검수 도구
├─ spec/            ← 입력 JSON (과거 실제 사례 = 작성 예시)
├─ assets/          ← 로고, 아이콘 14종
└─ output/          ← 산출물
```

## 도구

| 파일 | 용도 |
|---|---|
| `build_legal_sheet.py` | 월별 법규 탭 + 품의용 갑지 신규 생성 |
| `append_law.py` | 기존 탭에 법령 추가 / 개정이유 교체 |
| `ingest_pdf.py` | 보도자료 PDF → 텍스트·이미지·spec 뼈대 |
| `build_press_ppt.js` | 보도자료 요약 PPT (3장 고정) |
| `build_report_ppt.js` | 분석 보고서 PPT (블록 자유 구성) |
| `edit_report_ppt.py` | 기존 PPT에 슬라이드 추가 (편집 보존) |
| `add_p19_22.py` | 위 도구의 실제 적용 예시 |
| `qa_layout.py` | PPT 이탈·겹침·넘침 자동 검수 |
| `make_icons.js` | react-icons → PNG 래스터화 |

## 참고할 입력 예시

| spec 파일 | 유형 |
|---|---|
| `legal_2026-08.json` | 법규 (주택법, 조문 다수) |
| `append_2026-08_시행령.json` | 기존 탭에 법령 추가 |
| `20260715_기본형건축비_비정기고시.json` | 보도자료 3장 |
| `20260803_오피스텔_영향분석.json` | 분석 보고서 8장 |
| `20260803_부동산세제합리화.json` | 인포그래픽 재작성 7장 |
