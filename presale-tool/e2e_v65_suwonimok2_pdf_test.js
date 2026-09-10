/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 21차 라운드 실사례
 * 북수원이목지구 대방 디에트르 더 리체Ⅱ(A3BL) 입주자모집공고문 "정정"(17페이지, 2025.04
 * 원 공고문을 2025.05 정정, 민영 아파트, 리체Ⅰ의 자매 단지). 사용자가 직접 업로드한 실제
 * PDF(fixtures/suwon_imok_detree_riche2_a3bl_correction.pdf)를 PDF 첨부 경로로 업로드해,
 * "P" 접미사가 붙는 다락(복층)세대 타입(84AP 등)을 포함한 14개 타입 전부가 정확히 인식되는지,
 * "정정 전"/"정정 후" 옵션 대조 블록이 있어도 혼동 없이 실제 본문 값만 채택되는지, 옵션
 * 카탈로그가 페이지 경계에서 끊기고 코드가 재출현하는 84B/84BP 쌍도 동일한 최저가로 정확히
 * 인식되는지, 엑셀 다운로드 결과까지 검증한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'suwon_imok_detree_riche2_a3bl_correction.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('141BP');
  }, { timeout: 30000 });

  const areaVal = await page.inputValue('#ta-area');
  const allCodes = ['84A', '84B', '84C', '84AP', '84BP', '84CP', '115A', '115AP', '116B', '116BP', '139A', '139AP', '141B', '141BP'];
  for (const code of allCodes) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음: ' + areaVal.slice(0, 300));
  }

  await page.fill('#inp-name', '북수원이목지구 대방 디에트르 더 리체Ⅱ(A3BL)');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '수원시 장안구 이목동');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of allCodes) {
    if (!chips.includes(code + ' ✓')) throw new Error('타입 ' + code + '의 세대수 합계가 표기 세대수와 불일치(또는 인식 실패): ' + chips);
  }
  // 84B/84BP 둘 다 페이지 경계에서 끊긴 옵션 카탈로그가 정확히 병합되어 같은 최저가(120,000)여야 한다.
  const chips84B = chips.slice(chips.indexOf('84B ✓'), chips.indexOf('84C ✓'));
  const chips84BP = chips.slice(chips.indexOf('84BP ✓'));
  if (!chips84B.includes('옵션120,000')) throw new Error('84B 옵션 최저가(120,000)가 분석 칩에 없음(카탈로그 페이지 경계 병합 실패 가능성): ' + chips84B);
  if (!chips84BP.includes('옵션120,000')) throw new Error('84BP 옵션 최저가(120,000)가 분석 칩에 없음: ' + chips84BP);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  for (const code of allCodes) {
    if (!summaryHtml.includes(code)) throw new Error(code + ' 타입이 요약 탭에 없음');
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_suwonimok2.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  // 다락세대 141BP 타입의 최상층 분양가(2,029,960,000)가 엑셀에 정확히 반영됐는지 확인한다.
  let found141BP = false;
  ws.eachRow((row) => {
    const code = row.getCell(5).value; // E열 = 약식표기(타입 코드)
    if (code === '141BP' && row.getCell(9).value === 2029960000) found141BP = true; // I열 = 분양가
  });
  if (!found141BP) throw new Error('엑셀에 141BP타입 최상층(다락) 분양가(2,029,960,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 북수원이목지구 대방 디에트르 더 리체Ⅱ(A3BL) 정정 공고문 PDF 첨부 실사례 E2E 통과(P타입 14개/카탈로그 페이지 경계 병합 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
