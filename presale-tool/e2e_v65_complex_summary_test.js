/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 단지별 요약본(AF~AK) 신규 기능 회귀 테스트.
 *
 * 사용자가 "단지별 요약본을 추가하려 하는데 AF~AK열 부분 참고해서 요소 하나하나 파악해서
 * 그대로 넣어서 작성해줘"라며 실사용 서식 예시(메인 표 옆 AF~AK열에 붙는 타입별 요약 표)를
 * 제공해 openpyxl로 뜯어본 뒤 반영한 구조를 검증한다(자세한 내용은 README.md "엑셀 내보내기
 * 스타일/구조 > 25차" 참고):
 *   1. 각 단지의 데이터 시작행(fd = 제목행+5)부터 AF~AK열에 제목/사용승인일·세대수/헤더 2행/
 *      타입별 요약 행이 붙는다.
 *   2. 타입은 메인 표의 "OO합계"(약식표기 숫자 접두부)가 아니라 "평형대"(전용평수를 10평
 *      단위로 내림한 값)로 묶인다 - 예시 파일 5개 단지를 openpyxl로 전부 대조해 확인한
 *      기준이며, 약식표기 접두부가 서로 달라도(예: 102와 124, 75와 84A~D) 평형대만 같으면
 *      한 그룹으로 묶인다.
 *   3. 평형대에 타입이 하나뿐이면 그 타입 행 + 자기 값을 그대로 반복하는 마감행(옅은 주황),
 *      둘 이상이면 타입별 행 + 세대수 가중평균 마감행(옅은 주황)으로 마무리하고, 맨 아래
 *      "평균" 행(옅은 빨강)은 각 평형대의 마감행만 참조해 전체 가중평균한다.
 *   4. "총 N 세대수"는 예시 파일에 하드코딩 텍스트로 박혀 있었지만, 이 프로젝트 원칙대로
 *      합계 행(H열)을 실시간 참조하는 수식으로 반영했다(의도적 차이).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'osan_heritage_xi_1danji.pdf'));
  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.length > 30;
  }, { timeout: 20000 });

  await page.fill('#inp-name', '오산헤리티지자이 1단지');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '오산시');
  await page.selectOption('#inp-kind', '아파트');
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_complex_summary_test.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];
  await browser.close();

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }
  function f(addr) { const v = ws.getCell(addr).value; return v && v.formula; }

  // 데이터 시작행(fd)은 A3(제목)+5 = 8. 타입 구성: 75/84A/84B/84C/84D(20평대, 5개)
  // /102/124(30평대, 2개)/166P(50평대, 1개).
  check('CS01', '단지명 제목 셀이 메인 표 제목(A3)을 실시간 참조', f('AF8') === 'A3');
  check('CS02', '"*공급평형기준" 안내 문구', ws.getCell('AJ8').value === '*공급평형기준');
  check('CS03', '"총 N 세대수"가 합계 행(H58)을 실시간 참조하는 수식(하드코딩 아님)',
    f('AH9') === '"총 "&H58&" 세대수"');
  check('CS04', '헤더 2행: "구분(평형)"/"세대수"/"분양가" + "타입"/"전용(평)"/"공급(평)"/"평균"/"평당가"',
    ws.getCell('AF10').value === '구분(평형)' && ws.getCell('AI10').value === '세대수' && ws.getCell('AJ10').value === '분양가'
      && ws.getCell('AF11').value === '타입' && ws.getCell('AG11').value === '전용(평)' && ws.getCell('AH11').value === '공급(평)'
      && ws.getCell('AJ11').value === '평균' && ws.getCell('AK11').value === '평당가');
  check('CS05', '헤더 병합: AF10:AH10, AI10:AI11, AJ10:AK10',
    ws.getCell('AF10').isMerged && ws.getCell('AH10').isMerged && ws.getCell('AI10').isMerged && ws.getCell('AI11').isMerged
      && ws.getCell('AJ10').isMerged && ws.getCell('AK10').isMerged);

  // 20평대 그룹(75/84A/84B/84C/84D, 5개 타입) - 행12~16 + 마감행17
  check('CS06', '20평대 그룹 5개 타입(75,84A,84B,84C,84D)이 각자 한 행씩',
    ['75', '84A', '84B', '84C', '84D'].every((code, i) => ws.getCell('AF' + (12 + i)).value === code));
  check('CS07', '20평대 그룹 마감행(17)이 세대수 가중평균 SUMPRODUCT 수식',
    f('AG17') === 'SUMPRODUCT(AG12:AG16,AI12:AI16)/AI17' && f('AI17') === 'SUM(AI12:AI16)');
  check('CS08', '20평대 그룹 마감행이 옅은 주황 배경', ws.getCell('AF17').fill.fgColor.argb === 'FFFDEADA');

  // 30평대 그룹(102/124, 서로 다른 약식표기 접두부인데도 평형대가 같아 묶임) - 행18~19 + 마감행20
  check('CS09', '30평대 그룹(102,124 - 약식표기 접두부가 달라도 평형대가 같아 묶임)',
    ws.getCell('AF18').value === '102' && ws.getCell('AF19').value === '124');
  check('CS10', '30평대 그룹 마감행(20)도 세대수 가중평균 SUMPRODUCT 수식',
    f('AG20') === 'SUMPRODUCT(AG18:AG19,AI18:AI19)/AI20');

  // 50평대 단일 타입(166P) - 행21(데이터) + 행22(자기 값을 그대로 반복하는 마감행)
  check('CS11', '50평대 단일 타입(166P) - 데이터 행 뒤에 자기 값을 그대로 반복하는 마감행',
    ws.getCell('AF21').value === '166P' && f('AG22') === 'AG21' && f('AI22') === 'AI21');
  check('CS12', '단일 타입 마감행도 그룹 마감행과 동일하게 옅은 주황 배경',
    ws.getCell('AF22').fill.fgColor.argb === 'FFFDEADA');

  // 맨 아래 평균 행(23) - 각 평형대의 마감행(17,20,22)만 참조
  check('CS13', '평균 행(23)이 20/30/50평대 마감행(17,20,22)만 세대수 가중평균으로 참조',
    f('AG23') === '(AG17*$AI$17+AG20*$AI$20+AG22*$AI$22)/$AI$23'
      && f('AI23') === 'AI17+AI20+AI22');
  check('CS14', '평균 행이 bold + 옅은 빨강 배경', ws.getCell('AF23').font.bold === true && ws.getCell('AF23').fill.fgColor.argb === 'FFE6B9B8');
  check('CS15', '평균 행 평당가(AK23)는 분양가/공급평 직접 나눗셈', f('AK23') === 'AJ23/AH23');

  // 공통 서식: 9pt 나눔바른고딕, 데이터 행 가운데 정렬, 헤더 회색 배경
  check('CS16', '데이터 셀 폰트가 9pt 나눔바른고딕', ws.getCell('AF12').font.size === 9 && ws.getCell('AF12').font.name === '나눔바른고딕');
  check('CS17', '헤더 행 회색 배경(FFD9D9D9)', ws.getCell('AF10').fill.fgColor.argb === 'FFD9D9D9');
  check('CS18', '전용(평)/공급(평) 열에 "0.0"평"" 숫자 서식', ws.getCell('AG12').numFmt === '0.0"평"' && ws.getCell('AH12').numFmt === '0.0"평"');

  console.log(`[e2e_v65_complex_summary_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('\n✅ 단지별 요약본(AF~AK) 신규 기능 회귀 E2E 통과');
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
