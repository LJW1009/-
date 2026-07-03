# 분양가 정리 도구

한국 분양공고(공급면적/공급금액/발코니확장비/에어컨옵션가) 텍스트를 파싱해
분양가를 정리하고 마스터 엑셀로 출력하는 단일 HTML 웹앱.

## 구조

| 파일 | 역할 |
|---|---|
| `parser.js` | 파서: `parseAreaSection`, `parsePriceSection`, `parseBalconySection`, `parseOptionSection`, `extractMeta` |
| `excel.js` | 엑셀 빌더: `buildBlock(sd, merges, rh, unit, startRow)` |
| `app.html` / `logic.js` | 프론트엔드 (입력 탭 / 결과·수정 탭) |
| `test_cases.js`, `test_cases_c.js`, `test_cases_d.js` | 파서 단위/통합/실사례 회귀 테스트 (총 78개) |
| `run_tests.js`, `run_tests_c.js`, `run_tests_d.js` | 테스트 실행기 |
| `test_excel.js` | 엑셀 빌더 검증 (Node `xlsx` 패키지 사용) |
| `e2e_test.js` | 브라우저(Playwright) 종단 테스트 |
| `build.js` | 최종 조합: SheetJS + parser + excel + logic을 `app.html`에 인라인하여 `dist/분양가정리.html` 생성 |
| `vendor/xlsx.full.min.js` | SheetJS 번들 (오프라인 사용을 위해 체크인됨) |

## 실행

```bash
npm install          # xlsx(테스트용), playwright(E2E용)
npm test             # 파서 78/78 + 엑셀 빌더 검증
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

실제 확인된 8개 단지 분양공고 사례(의정부역 센트럴 아이파크, 영통역 우미린, 김포 풍무
레이크에듀시티, 번영로 롯데캐슬, 더폴 우정, 더샵 송도그란테르, 힐스테이트 안양 펠루스,
더폴 울산신정)의 헤더 6패턴/코드 5형식/층구분 8형식/동호 6형식/날짜 5형식/에어컨 4형식을
`test_cases_d.js`로 회귀 고정했다. 다만 아래는 여전히 제한적으로만 지원된다.

- **코드 없이 라인번호만 있는 동/라인 표기** (예: "1", "3"만 있고 "동"/"호"/"라인" 접미사가
  없는 경우): 층 번호와 구분할 근거가 없어 지원하지 않음. "라인" 접미사가 있는 경우만 인식.
- **접미사 없는 순수 소수 코드** (예: "059.9700" 단독, 문자 없음): 순수 면적값과 형태가
  동일해 구분 불가능하므로 지원하지 않음(실사례에서도 확인되지 않은 형식). 순수 숫자 코드는
  정수형("76", "105")만 지원.
- 전용/공급면적 외에 공용면적·계약면적 등 부가 열이 더 있는 공급대상표는 코드 숫자 접두부와의
  근접도로 전용면적을 추정하는 휴리스틱을 쓰므로, 코드가 면적을 반영하지 않는 임의 표기(오피스텔
  호실번호 등)에서는 최솟값 폴백으로 동작한다.
- PDF 복사 오염 교정(`잔금대지비` 등 키워드 붙음, 표 전체가 한 줄로 직렬화되는 경우)은 가격
  섹션에서만 지원하며, codes 목록이 함께 전달된 경우에만 동작한다.
