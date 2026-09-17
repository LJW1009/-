/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 타입별 중도금 이자 조건(무이자/이자후불제)
 * 오버라이드 회귀 테스트.
 *
 * 사용자가 "중도금 대출의 경우 이자후불제나 무이자의 경우 중도금 대출 파트에 다
 * 나와있어 이 부분도 참고해서... 타입별로 중도금 대출이 상이한 경우도 적용
 * 가능하게끔 중도금 대출 안내 파트도 인식하게 프로그램 재설계해줘"라고 요청했다
 * (실사례: 힐스테이트 송파더그리드 오피스텔 - "34A/34B/36 타입은 무이자,
 * 42~119 타입은 이자후불제"). parser.js에 parseInterestSection을 신설하고,
 * unit.interest(단지 전체 기본값)와 별개로 타입 데이터에 선택적 t.interest
 * (있으면 그 타입에 한해 우선 적용, 없으면 단지 전체 설정을 그대로 씀)를
 * 두어 app_v65_source.html의 buildBlock이 타입별로 이자 계산을 분기하도록
 * 재설계했다(group_key 오버라이드와 동일한 설계 원칙).
 *
 * 검증:
 *   1. 단지 전체 설정이 "이자 후불제"(rate>0)여도, t.interest='무이자'인 타입은
 *      회차별 이자 열이 전부 0으로 계산됨.
 *   2. t.interest가 없는(오버라이드 안 한) 타입은 기존처럼 단지 전체 설정을 그대로
 *      따라 이자가 0이 아니게 계산됨(회귀 없음 확인).
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

  const unitPayload = {
    id: Date.now(),
    name: 'INTERESTTEST', r1: '테스트', r2: '테스트',
    kind: '오피스텔', interest: '후불제', rate: 0.05,
    open_date: '2026.01.01', open_dt: '2026-01-01',
    move_in: '2029.01 예정', move_in_dt: '2029-01-01',
    mid_dates: ['2026-06-01', '2026-09-01', '2027-01-01', '2027-06-01', '2027-09-01', '2028-01-01'],
    raw: { price: '', area: '', balc: '', opt: '' },
    types: [
      // 단지 전체 설정은 이자 후불제(rate 5%)이지만, 이 타입만 t.interest='무이자'
      // 오버라이드가 있어 이자가 전부 0이어야 한다.
      { code: 'A1', exclusive_area: 34.99, supply_area: 50.19, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
        interest: '무이자',
        rows: [{ dong: '', floor: '1층', units: 1, price: 300000000, mid_amounts: [30000000,30000000,30000000,30000000,30000000,30000000] }] },
      // 오버라이드 없음 - 단지 전체 설정(이자 후불제, rate 5%)을 그대로 따라야 한다.
      { code: 'B1', exclusive_area: 42.99, supply_area: 61.26, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
        rows: [{ dong: '', floor: '2층', units: 1, price: 500000000, mid_amounts: [50000000,50000000,50000000,50000000,50000000,50000000] }] },
    ],
  };

  await page.evaluate((payload) => {
    const u = Object.assign({}, payload);
    u.open_dt = new Date(u.open_dt);
    u.move_in_dt = new Date(u.move_in_dt);
    u.mid_dates = u.mid_dates.map(s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); });
    units.push(u);
    saveUnits(); updateBadge(); renderSidebar(); showPage('res'); selectUnit(u.id);
  }, unitPayload);
  await page.waitForSelector('#pg-res.on');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_interest_override_test.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];
  await browser.close();

  let pass = 0, fail = 0;
  function check(id, desc, cond) {
    if (cond) { pass++; }
    else { fail++; console.log(`[FAIL] ${id}: ${desc}`); }
  }

  // 타입 코드(E열, col5)로 A1/B1 행을 찾는다.
  let rowA1 = null, rowB1 = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const code = ws.getCell(r, 5).value;
    if (code === 'A1') rowA1 = r;
    if (code === 'B1') rowB1 = r;
  }
  check('I01', 'A1(무이자 오버라이드) 데이터 행을 찾음', rowA1 !== null);
  check('I02', 'B1(오버라이드 없음) 데이터 행을 찾음', rowB1 !== null);

  // 회차별 이자 열(W~AB, 23~28) 전부가 0인지 확인(무이자 오버라이드가 단지 전체
  // 설정보다 우선 적용됐는지의 핵심 증거). AC열(29)은 이 6개 열의 SUM 수식이라
  // ExcelJS가 캐시된 계산값을 갖고 있지 않으므로(수식 문자열만 기록됨) 여기서는
  // 원본 값이 실제로 기록되는 회차별 열로 직접 검증한다.
  if (rowA1 !== null) {
    const midColsA1 = [23,24,25,26,27,28].map(c => ws.getCell(rowA1, c).value);
    check('I03', 'A1(무이자 오버라이드)의 회차별 이자 열 6개가 전부 0(단지 전체는 이자후불제 5%지만 타입 오버라이드가 우선 적용됨)',
      midColsA1.every(v => v === 0));
  } else { fail++; }

  if (rowB1 !== null) {
    const mid1ColB1 = ws.getCell(rowB1, 23).value;
    check('I05', 'B1(오버라이드 없음)은 단지 전체 설정(이자후불제 5%)을 그대로 따라 이자가 0이 아닌 수식으로 계산됨(회귀 없음)',
      mid1ColB1 && typeof mid1ColB1 === 'object' && /\*/.test(mid1ColB1.formula || ''));
  } else { fail++; }

  console.log(`[e2e_v65_interest_override_test.js] ${pass}/${pass+fail} 통과`);
  if (errors.length) console.log('브라우저 에러:', errors);
  if (fail > 0 || errors.length) process.exit(1);
  console.log('\n✅ 타입별 중도금 이자 조건(무이자/이자후불제) 오버라이드 회귀 E2E 통과');
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
