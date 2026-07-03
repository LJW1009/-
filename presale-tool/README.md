# 분양가 정리 도구

한국 분양공고(공급면적/공급금액/발코니확장비/에어컨옵션가) 텍스트를 파싱해
분양가를 정리하고 마스터 엑셀로 출력하는 단일 HTML 웹앱.

## 구조

| 파일 | 역할 |
|---|---|
| `parser.js` | 파서: `parseAreaSection`, `parsePriceSection`, `parseBalconySection`, `parseOptionSection`, `extractMeta` |
| `excel.js` | 엑셀 빌더: `buildBlock(sd, merges, rh, unit, startRow)` |
| `app.html` / `logic.js` | 프론트엔드 (입력 탭 / 결과·수정 탭) |
| `test_cases.js`, `test_cases_c.js` | 파서 단위/통합 테스트 (총 48개) |
| `run_tests.js`, `run_tests_c.js` | 테스트 실행기 |
| `test_excel.js` | 엑셀 빌더 검증 (Node `xlsx` 패키지 사용) |
| `e2e_test.js` | 브라우저(Playwright) 종단 테스트 |
| `build.js` | 최종 조합: SheetJS + parser + excel + logic을 `app.html`에 인라인하여 `dist/분양가정리.html` 생성 |
| `vendor/xlsx.full.min.js` | SheetJS 번들 (오프라인 사용을 위해 체크인됨) |

## 실행

```bash
npm install          # xlsx(테스트용), playwright(E2E용)
npm test             # 파서 48/48 + 엑셀 빌더 검증
npm run test:e2e     # 브라우저 종단 테스트
npm run build        # dist/분양가정리.html 생성
```

`dist/분양가정리.html`은 외부 리소스 없이 그대로 브라우저에서 열어 사용할 수 있는
단일 파일 산출물이다.

## 데이터 흐름

1. 입력 탭에서 4개 섹션 텍스트를 붙여넣고 `parseAreaSection`으로 주택형/코드 목록을 얻는다.
2. 그 코드 목록을 `parsePriceSection` / `parseBalconySection` / `parseOptionSection`에
   전달해 코드 표기 형식(관리번호/호형/숫자만 등)에 관계없이 정확히 매칭한다.
3. 결과를 `unit.types[].rows[]` 구조로 합쳐 상태에 저장한다 (localStorage 보조,
   JSON 내보내기/불러오기가 주 저장 수단).
4. 엑셀 다운로드 시 `unit` 배열을 순회하며 `buildBlock`을 반복 호출해 하나의 시트에
   단지별 블록을 이어붙인다.

## 알려진 제한사항

실제 분양공고 PDF 원본 샘플 없이 설계되었으므로, 파서는 문서에 기술된 변형
(단위 원/천원, 대지비·건축비·부가세 합계 오프셋, 7가지 층구분 표기, 계약금 정액/비율,
아파트형/오피스텔형/면적먼저형 공급대상표)을 헤더 우선 파싱 원칙으로 처리하도록
설계·테스트되었다. 실제 문서의 표 형식이 크게 다르면 `tokenize()`/`isNum()` 등의
정규식을 해당 형식에 맞게 조정해야 할 수 있다.
