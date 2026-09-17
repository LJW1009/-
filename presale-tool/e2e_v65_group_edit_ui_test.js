/*
 * v6.5 기반 산출물(dist/분양가정리.html) - "수정" 탭 UI로 그룹 오버라이드 입력 회귀 테스트.
 *
 * 28차에서 group_key/group_label 필드 자체는 추가했지만, 그때는 Claude가 직접 스크립트로
 * unit 객체에 주입한 것이었다. 사용자가 "해당 논리를 프로그램에도 적용해줘"라고 요청해,
 * 사용자가 직접 앱 UI(수정 탭)에서 타입별로 "합계 그룹" 텍스트를 입력할 수 있게 만들었다 -
 * 같은 문자열을 입력한 타입끼리 메인 표 "OO합계"/AF~AK 요약본에서 묶이고, 비워두면 기존
 * 자동 규칙(숫자 접두부/전용면적 10평 단위)으로 되돌아간다.
 *
 * 검증: 숫자 접두부도 다르고(115 vs 117) 전용면적 평형대도 다른(115.0㎡ vs 117.0㎡ - 둘 다
 * 우연히 30평대이긴 하지만, 이 테스트는 접두부가 다른 게 핵심) 두 타입에 "수정" 탭에서
 * 같은 그룹명을 입력하고 저장한 뒤 엑셀을 받아, 그 그룹명으로 묶인 합계 행이 실제로
 * 생성되는지 확인한다(파서를 거치지 않는 수동 등록 유닛으로 UI 경로만 검증).
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

  await page.evaluate(() => {
    const u = {
      id: Date.now(), name: 'GROUPUITEST', r1: '테스트', r2: '테스트',
      kind: '오피스텔', interest: '무이자', rate: 0,
      open_date: '2026.01.01', open_dt: new Date('2026-01-01'),
      move_in: '2029.01 예정', move_in_dt: new Date('2029-01-01'),
      mid_dates: null,
      raw: { price: '', area: '', balc: '', opt: '' },
      types: [
        { code: '115A', exclusive_area: 115.0, supply_area: 150.0, supply_units: 2, balcony_ext_cost: 0, option_cost: 0,
          rows: [{ dong: '', floor: '1층', units: 1, price: 300000000, mid_amounts: [] },
                 { dong: '', floor: '2층', units: 1, price: 310000000, mid_amounts: [] }] },
        { code: '117C-T1', exclusive_area: 117.0, supply_area: 156.0, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
          rows: [{ dong: '', floor: '3층', units: 1, price: 400000000, mid_amounts: [] }] },
        // group을 지정하지 않는 세 번째 타입 - 기존 숫자 접두부 규칙(84 단독, 그룹행 없음)이
        // 그대로 유지되는지 함께 확인한다.
        { code: '84A', exclusive_area: 84.9, supply_area: 108.0, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
          rows: [{ dong: '', floor: '4층', units: 1, price: 500000000, mid_amounts: [] }] },
      ],
    };
    units.push(u); saveUnits(); updateBadge(); renderSidebar(); showPage('res'); selectUnit(u.id);
  });
  await page.waitForSelector('#pg-res.on');
  await page.evaluate(() => switchTab('edit'));
  await page.waitForSelector('#e-group-0');

  // UI를 통해 사용자가 직접 두 타입에 같은 그룹명을 입력.
  await page.fill('#e-group-0', '115~117');
  await page.fill('#e-group-1', '115~117');
  await page.evaluate(() => saveEdit());
  await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_group_edit_ui_test.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];
  await browser.close();

  let pass = 0, fail = 0;
  function check(id, desc, cond) {
    if (cond) pass++; else { fail++; console.log(`[FAIL] ${id}: ${desc}`); }
  }

  const colA = [];
  for (let r = 1; r <= ws.rowCount; r++) colA.push(ws.getCell(r, 1).value);
  check('U01', '수정 탭에서 입력한 그룹명("115~117")으로 두 타입(115A/117C-T1)이 묶인 합계 행이 생성됨',
    colA.some(v => v === '115~117합계'));
  check('U02', '그룹명을 입력하지 않은 84A는 단독이라(회귀: 기존처럼) 그룹 합계 행 자체가 생성되지 않음',
    !colA.some(v => v === '84합계'));
  check('U03', '숫자 접두부(115)나 group_key 원본이 라벨로 잘못 노출되지 않음',
    !colA.some(v => v === '115합계'));

  console.log(`[e2e_v65_group_edit_ui_test.js] ${pass}/${pass+fail} 통과`);
  if (errors.length) console.log('브라우저 에러:', errors);
  if (fail > 0 || errors.length) process.exit(1);
  console.log('\n✅ "수정" 탭 UI 그룹 오버라이드 입력 회귀 E2E 통과');
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
