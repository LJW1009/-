/*
 * v6.5 기반 산출물(dist/분양가정리.html) - "수정" 탭 합계 그룹 "일괄 설정" UI 회귀 테스트.
 *
 * 사용자가 "타입별 구분 형식을 내가 구분할 수 있게끔 하고 싶은데... 입력 방식을 더
 * 편리하게 바꿔줘"라고 요청했다. 기존에는 타입마다 "합계 그룹(선택)" 칸에 같은 글자를
 * 하나씩 직접 타이핑해야 했는데(28차), 타입이 많을 때 번거로웠다. 체크박스로 묶을
 * 타입들을 한 번에 고르고 그룹 이름을 한 번만 입력하면 체크한 타입들의 칸에 전부
 * 채워지는 "일괄 설정" 패널을 추가했다 - 그 뒤에도 저장 버튼을 눌러야 최종 반영되는
 * 기존 흐름은 그대로다(개별 칸 수정도 계속 가능).
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
    name: 'BULKGROUPTEST', r1: '테스트', r2: '테스트',
    kind: '오피스텔', interest: '무이자', rate: 0,
    open_date: '2026.01.01', open_dt: '2026-01-01',
    move_in: '2029.01 예정', move_in_dt: '2029-01-01',
    mid_dates: ['2026-06-01','2026-09-01','2027-01-01','2027-06-01','2027-09-01','2028-01-01'],
    raw: { price: '', area: '', balc: '', opt: '' },
    types: ['115A', '117C-T1', '118C-T2', '84A'].map((code, i) => ({
      code, exclusive_area: 50 + i, supply_area: 65 + i, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
      rows: [{ dong: '', floor: (i + 1) + '층', units: 1, price: 300000000 + i * 10000000, mid_amounts: [10000000,10000000,10000000,10000000,10000000,10000000] }],
    })),
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

  // "수정" 탭으로 이동해 일괄 설정 패널로 115A/117C-T1/118C-T2 세 타입만 체크하고
  // 그룹 이름을 입력한 뒤 "적용"을 누른다(84A는 체크하지 않음 - 안 묶여야 함).
  await page.click('.stab:has-text("수정")');
  const checks = await page.locator('.group-bulk-chk').all();
  for (const chk of checks) {
    const ti = await chk.getAttribute('data-ti');
    const code = unitPayload.types[Number(ti)].code;
    if (['115A', '117C-T1', '118C-T2'].includes(code)) await chk.check();
  }
  await page.fill('#group-bulk-name', '115~118그룹');
  await page.click('button:has-text("적용")');

  // 일괄 적용 직후 개별 타입 칸에 값이 채워졌는지 먼저 확인(저장 전 DOM 상태).
  let filledCount = 0;
  for (const chk of checks) {
    const ti = await chk.getAttribute('data-ti');
    const val = await page.inputValue(`#e-group-${ti}`);
    if (val === '115~118그룹') filledCount++;
  }

  // 페이지에 "💾 저장" 텍스트를 가진 버튼이 여러 개 있다(사이드바의 exportJSON 버튼 등) -
  // 실제 저장 버튼은 id로 명확히 지정한다.
  await page.click('#btn-save-edit');
  await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_group_bulk_ui_test.xlsx');
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

  check('GB01', '일괄 설정 적용 직후(저장 전) 체크한 3개 타입의 "합계 그룹(선택)" 칸에 그룹 이름이 채워짐', filledCount === 3);

  const colA = [];
  for (let r = 1; r <= ws.rowCount; r++) colA.push(ws.getCell(r, 1).value);
  check('GB02', '저장 후 다운로드한 엑셀에 "115~118그룹합계" 행이 실제로 생성됨', colA.some(v => v === '115~118그룹합계'));
  check('GB03', '체크하지 않은 84A는 그룹에 안 묶이고 기존처럼 "84합계"로 남음(단일 타입이라 그룹 행 자체가 안 생김 - 84합계라는 값 자체가 없어야 함)',
    !colA.some(v => v === '84합계') && !colA.some(v => v === 'undefined합계'));

  console.log(`[e2e_v65_group_bulk_ui_test.js] ${pass}/${pass+fail} 통과`);
  if (errors.length) console.log('브라우저 에러:', errors);
  if (fail > 0 || errors.length) process.exit(1);
  console.log('\n✅ "수정" 탭 합계 그룹 일괄 설정 UI 회귀 E2E 통과');
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
