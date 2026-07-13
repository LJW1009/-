/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 청약 접수건수 입력 필드 회귀 테스트.
 *
 * 이 데이터(특별공급/1·2순위 접수건수)는 분양공고 원문에는 없고 분양 진행 중 실시간으로
 * 갱신되는 정보라 파서가 채우지 않는다. "수정" 탭에 입력 필드를 추가해 사용자가 직접
 * 입력하면 엑셀에 값/수식이 채워지고, 입력하지 않은 타입은 여전히 빈 칸으로 남는지
 * (억지로 0을 채우지 않는지) 검증한다.
 * (계약 일차별 건수/계약총계/잔여/분양률/청약일정등 입력 필드는 엑셀 내보내기에서
 *  해당 열 자체가 삭제됨에 따라 UI에서도 함께 제거됐다 - 더 이상 이 테스트 대상이 아니다.)
 */
const { chromium } = require('playwright');
const path = require('path');
const ExcelJS = require('exceljs');
const { TEXT } = require('./test_cases_e.js');

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  // 더폴 울산신정(84A/84B 두 타입) - 84A에만 청약/계약 현황을 입력해 84B는 빈 칸으로 남는지도 확인
  await page.fill('#inp-name', '더폴 울산신정');
  await page.selectOption('#inp-r1', '울산광역시');
  await page.fill('#inp-r2', '남구 신정동');
  await page.selectOption('#inp-kind', '아파트');
  await page.fill('#ta-area', TEXT.AREA_TEXT);
  await page.fill('#ta-price', TEXT.PRICE_TEXT);
  await page.fill('#ta-balc', TEXT.BALCONY_TEXT);
  await page.fill('#ta-opt', TEXT.OPTION_TEXT);
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  await page.click('button:has-text("✏️ 데이터 수정")');
  await page.waitForSelector('#e-sp-local-0');
  await page.fill('#e-sp-local-0', '38');
  await page.fill('#e-sp-other-0', '12');
  await page.fill('#e-r1-local-0', '250');
  await page.fill('#e-r1-other-0', '80');
  await page.fill('#e-r2-local-0', '40');
  await page.fill('#e-r2-other-0', '10');
  await page.fill('#e-remark-0', '테스트 비고');
  await page.click('#btn-save-edit');
  await page.waitForFunction(() => document.getElementById('btn-save-edit').style.display === 'none');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_subscription_test.xlsx');
  await download.saveAs(savePath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  const fs = require('fs');
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }

  // 84A는 행 8부터 시작(더폴 울산신정 데이터는 e2e_v65_test.js에서 이미 검증된 배치)
  check('T01', '84A 특별공급 당해/기타 값 반영', ws.getCell('T8').value === 38 && ws.getCell('U8').value === 12);
  check('T02', '84A 1순위/2순위 당해·기타 값 반영',
    ws.getCell('V8').value === 250 && ws.getCell('W8').value === 80 && ws.getCell('X8').value === 40 && ws.getCell('Y8').value === 10);
  check('T03', '합계(Z) 수식 = SUM(T:Y), 경쟁률(AA) 수식 = Z/D', ws.getCell('Z8').value.formula === 'SUM(T8:Y8)' && ws.getCell('AA8').value.formula === 'Z8/D8');
  check('T04', '비고 텍스트 반영', ws.getCell('AB8').value === '테스트 비고');
  // 계약 1~5일차/계약총계/잔여/분양률/청약일정등(구 AC~AK) 열은 삭제됐다 - AC8은
  // 이제 아무 값도 갖지 않는다(더 이상 계약 일차 입력 필드 자체가 UI에 없음).
  check('T05', '계약 일차 등(구 AC~AK) 열이 삭제되어 값이 없음', ws.getCell('AC8').value == null);

  // 84B(입력 안 한 타입)는 값도 수식도 전혀 없어야 함(억지로 0을 채우지 않는다는 원칙 검증)
  check('T06', '입력하지 않은 84B는 청약 컬럼이 전부 빈 칸(0을 채우지 않음)',
    ws.getCell('T20').value == null && ws.getCell('Z20').value == null);

  console.log(`[e2e_v65_subscription_fields_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    await browser.close();
    process.exit(1);
  }
  console.log('\n✅ 청약 접수건수/계약 진행 현황 입력 필드 E2E 통과');
  await browser.close();
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
