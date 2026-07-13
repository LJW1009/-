/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 18차 회귀 테스트.
 *
 * 사용자가 "요약 탭에서 오피스텔 평당가가 계약면적 기준으로 나온다"와 "이자후불제인데
 * 엑셀에 중도금(이자)이 반영 안 된다"고 제보해 원인을 추적한 뒤 고친 두 가지 버그를 검증한다.
 *
 *   1. 요약 탭(renderSummary)의 평당가 계산이 unit.kind와 무관하게 항상 t.supply_area만
 *      썼다 - 오피스텔은 그 필드가 실제로는 계약면적이라(엑셀 h1l 라벨도 "계약면적") 전용
 *      면적 기준인 엑셀 결과와 요약 탭 숫자가 서로 달랐다. 아파트=공급면적, 오피스텔=
 *      전용면적 기준으로 통일했다.
 *   2. "수정" 탭에서 저장(saveEdit)할 때마다 t.rows를 편집 테이블 DOM(동/층/세대/분양가
 *      입력칸)에서 통째로 다시 만들면서, 그 입력칸에 없는 회차별 중도금 실납부액
 *      (row.mid_amounts, 파서가 원문에서 읽어온 값)을 그냥 버렸다 - 저장 버튼을 한 번이라도
 *      누르면(금리나 이자 조건만 고쳐도) 그 단지의 엑셀 중도금 이자가 전부 0으로 사라지는
 *      회귀였다. 같은 (동,층) 키로 기존 행의 mid_amounts를 이어받도록 고쳤고, 행을 중간에서
 *      삭제해도(DOM 인덱스가 밀려도) 내용 기반 매칭이라 엉뚱한 행에 붙지 않는다.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { TEXT } = require('./test_cases_e.js');
const { TEXT: OFFICETEL_TEXT } = require('./test_cases_j.js');

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }

  // ── ① 오피스텔 요약 탭 평당가 = 전용면적 기준 ─────────────────────────
  await page.fill('#inp-name', '힐스테이트 둔산 오피스텔');
  await page.selectOption('#inp-r1', '대전광역시');
  await page.fill('#inp-r2', '서구 탄방동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.fill('#ta-area', OFFICETEL_TEXT.AREA_TEXT);
  await page.fill('#ta-price', OFFICETEL_TEXT.PRICE_TEXT);
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryOff = await page.evaluate(() => {
    const u = units[units.length - 1];
    const t = u.types[0];
    const row = t.rows[0];
    const exclusivePyeong = t.exclusive_area * 0.3025;
    const expectedPer = Math.round(row.price / exclusivePyeong);
    return { html: document.getElementById('tab-summary').innerHTML, expectedPer };
  });
  check('U01', '오피스텔 요약 탭 평당가가 전용면적 기준(계약면적 기준이 아님)으로 표시됨',
    summaryOff.html.includes(summaryOff.expectedPer.toLocaleString()));

  // ── ② saveEdit 이후에도 mid_amounts(회차별 중도금 실납부액)가 보존됨 ──────
  await page.click('#ntab-inp');
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

  const beforeSave = await page.evaluate(() => units[units.length - 1].types[0].rows[0].mid_amounts);
  check('U02', '저장 전 원본 mid_amounts가 파서로부터 정상 채워짐', Array.isArray(beforeSave) && beforeSave.length === 6 && beforeSave[0] > 0);

  await page.click('button:has-text("✏️ 데이터 수정")');
  await page.waitForSelector('#e-int');
  await page.selectOption('#e-int', '후불제'); // 이자후불제 명시 선택
  await page.fill('#e-rate', '4.6');
  await page.click('#btn-save-edit');
  await page.waitForFunction(() => document.getElementById('btn-save-edit').style.display === 'none');

  const afterSave = await page.evaluate(() => units[units.length - 1].types[0].rows[0].mid_amounts);
  check('U03', '금리/이자조건만 고쳐 저장해도 mid_amounts가 사라지지 않음(핵심 회귀)',
    Array.isArray(afterSave) && afterSave.length === 6 && afterSave[0] === beforeSave[0]);

  // 행을 하나 삭제해도(DOM 인덱스가 밀려도) 남은 행들의 mid_amounts가 내용 기준으로 안전하게 유지되는지
  const beforeDel = await page.evaluate(() => units[units.length - 1].types[0].rows.map(r => ({ floor: r.floor, mid0: r.mid_amounts[0] })));
  await page.click('button.del-row >> nth=0');
  await page.click('#btn-save-edit');
  await page.waitForFunction(() => document.getElementById('btn-save-edit').style.display === 'none');
  const afterDel = await page.evaluate(() => units[units.length - 1].types[0].rows.map(r => ({ floor: r.floor, mid0: r.mid_amounts[0] })));
  const expectedAfterDel = beforeDel.slice(1);
  check('U04', '행 삭제로 DOM 인덱스가 밀려도 남은 행들의 mid_amounts가 내용(동/층) 기준으로 올바르게 유지됨',
    JSON.stringify(afterDel) === JSON.stringify(expectedAfterDel));

  // ── ③ 엑셀에 실제로 0이 아닌 이자 수식이 반영되는지 최종 확인 ───────────
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_summary_interest_fix_test.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  const af8 = ws.getCell('AF8').value;
  check('U05', '이자후불제 단지의 엑셀 중도금 이자 수식이 0이 아닌 실제 원금을 참조함(수정 전엔 저장 후 전부 0으로 빠짐)',
    af8 && af8.formula && !af8.formula.startsWith('(0*'));

  console.log(`[e2e_v65_summary_interest_fix_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    await browser.close();
    process.exit(1);
  }
  console.log('\n✅ 요약 탭 평당가 기준 + 이자후불제 중도금 보존 회귀 E2E 통과');
  await browser.close();
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
