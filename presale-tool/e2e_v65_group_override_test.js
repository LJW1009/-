/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 그룹 합계(group_key/group_label) 오버라이드 회귀 테스트.
 *
 * 사용자가 목동윤슬자이 오피스텔 세부 분양가 작업 중 "타입 별 평균 내는게 전체표랑
 * 정리표랑 안 맞는다"며 직접 그룹 기준을 지정했다(115A/114B/114C를 하나로, 117C-T1~
 * 120A-T3를 하나로, 198CD~203AD를 하나로). 기존 두 자동 규칙 - 메인 표 "OO합계"는
 * 약식표기 숫자 접두부, AF~AK 요약본은 전용면적 10평 단위 내림 - 둘 다 이 단지에서는
 * 사용자가 원하는 묶음을 만들 수 없었다(접두부가 전부 달라 하나도 안 묶이거나, 반대로
 * 전부 30평대라 원치 않는 타입까지 뭉뚱그려짐). 타입 데이터에 선택적 group_key(묶음
 * 기준)/group_label(라벨, 생략 시 group_key 그대로)를 얹으면 두 표 모두 그 값을
 * 우선 쓰도록 app_v65_source.html에 추가했다(없으면 기존 자동 규칙 그대로 - 회귀 없음).
 *
 * 검증:
 *   1. group_key가 같은 타입들은 실제 전용면적 평형대(10평 단위)가 서로 달라도(예:
 *      50㎡대 vs 60㎡대) 메인 표 "OO합계"에서 하나로 묶이고, 라벨은 group_label을 씀.
 *   2. AF~AK 요약본에서도 같은 group_key 타입들이 하나의 마감행으로 묶인다(전용면적
 *      평형대가 아니라 group_key 기준).
 *   3. group_key가 없는 타입은 기존처럼 약식표기 숫자 접두부/전용면적 평형대 규칙이
 *      그대로 적용된다(회귀 없음 확인).
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
    name: 'GROUPTEST', r1: '테스트', r2: '테스트',
    kind: '오피스텔', interest: '무이자', rate: 0,
    open_date: '2026.01.01', open_dt: '2026-01-01',
    move_in: '2029.01 예정', move_in_dt: '2029-01-01',
    mid_dates: ['2026-06-01','2026-09-01','2027-01-01','2027-06-01','2027-09-01','2028-01-01'],
    raw: { price: '', area: '', balc: '', opt: '' },
    types: [
      // group_key가 같지만 전용면적 평형대(10평 단위)는 서로 다른 두 타입 - 오버라이드가
      // 없으면 절대 같은 그룹으로 안 묶여야 정상.
      { code: 'A1', exclusive_area: 50.0, supply_area: 65.0, supply_units: 2, balcony_ext_cost: 0, option_cost: 0,
        group_key: 'GA', group_label: 'A그룹',
        rows: [{ dong: '', floor: '1층', units: 1, price: 300000000, mid_amounts: [10000000,10000000,10000000,10000000,10000000,10000000] },
               { dong: '', floor: '2층', units: 1, price: 310000000, mid_amounts: [10000000,10000000,10000000,10000000,10000000,10000000] }] },
      { code: 'B1', exclusive_area: 65.0, supply_area: 82.0, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
        group_key: 'GA', group_label: 'A그룹',
        rows: [{ dong: '', floor: '3층', units: 1, price: 400000000, mid_amounts: [12000000,12000000,12000000,12000000,12000000,12000000] }] },
      // group_key 없는 일반 타입 - 기존 규칙(숫자 접두부 84, 전용면적 평형대) 그대로 적용돼야 함.
      { code: '84A', exclusive_area: 84.9, supply_area: 108.0, supply_units: 2, balcony_ext_cost: 0, option_cost: 0,
        rows: [{ dong: '', floor: '5층', units: 1, price: 500000000, mid_amounts: [15000000,15000000,15000000,15000000,15000000,15000000] },
               { dong: '', floor: '6층', units: 1, price: 510000000, mid_amounts: [15000000,15000000,15000000,15000000,15000000,15000000] }] },
      { code: '84B', exclusive_area: 84.6, supply_area: 107.0, supply_units: 1, balcony_ext_cost: 0, option_cost: 0,
        rows: [{ dong: '', floor: '7층', units: 1, price: 505000000, mid_amounts: [15000000,15000000,15000000,15000000,15000000,15000000] }] },
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
  const savePath = path.join(__dirname, 'tmp_group_override_test.xlsx');
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

  const colA = [];
  for (let r = 1; r <= ws.rowCount; r++) colA.push(ws.getCell(r, 1).value);
  check('G01', 'A그룹(group_label) 합계 행이 "A그룹합계"로 표시됨(group_key 오버라이드 라벨)',
    colA.some(v => v === 'A그룹합계'));
  check('G02', '84 접두부 그룹은 기존처럼 "84합계"로 표시됨(group_key 없는 타입은 회귀 없음)',
    colA.some(v => v === '84합계'));
  check('G03', 'group_key 자체("GA")가 라벨로 잘못 노출되지 않음(group_label 우선 적용 확인)',
    !colA.some(v => v === 'GA합계'));

  // AF~AK 요약본: A그룹(50㎡/65㎡, 서로 다른 평형대)이 하나의 마감행으로 묶였는지 확인.
  // 마감행은 AF열이 비어있고(undefined) 세대수(AI, col35)가 SUM 수식인 행으로 식별한다.
  let afRows = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const af = ws.getCell(r, 32).value;
    if (af === 'A1' || af === 'B1') afRows.push(r);
  }
  check('G04', 'AF~AK 요약본에 A그룹 타입(A1/B1) 둘 다 나타남(같은 그룹으로 인식되어 나란히 배치)',
    afRows.length === 2);
  if (afRows.length === 2) {
    const closingRow = afRows[1] + 1;
    const closingUnits = ws.getCell(closingRow, 35).value; // AI = units col(35)
    check('G05', 'A1/B1 마감행이 두 타입 세대수 합산(SUM) 수식을 가짐(평형대가 달라도 group_key로 하나의 마감행 생성)',
      closingUnits && typeof closingUnits === 'object' && /SUM\(/.test(closingUnits.formula || ''));
  } else {
    fail++; console.log('[FAIL] G05: A그룹 마감행을 찾을 수 없음');
  }

  console.log(`[e2e_v65_group_override_test.js] ${pass}/${pass+fail} 통과`);
  if (errors.length) console.log('브라우저 에러:', errors);
  if (fail > 0 || errors.length) process.exit(1);
  console.log('\n✅ 그룹 합계(group_key/group_label) 오버라이드 회귀 E2E 통과');
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
