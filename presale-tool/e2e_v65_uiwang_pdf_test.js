/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 20차 라운드 실사례(의왕역 SK
 * VIEW 입주자모집공고, 민영 아파트). 사용자가 직접 업로드한 실제 PDF(fixtures/uiwang_sk_view.pdf)를
 * PDF 첨부 경로로 업로드해, 레터 접미사형(59A/59B/84A/84B/84C)과 무접미사 관리코드형(36/45)이
 * 한 표에 섞인 공급면적표, 부가세 "-"(면제) 행이 섞인 공급금액표, 번호만 붙고 불릿이 없는
 * 옵션 대분류 제목 뒤의 카탈로그형 다항목 옵션표까지 실제 브라우저에서 끝까지 정상 동작하는지,
 * 그리고 엑셀 다운로드 결과에도 정확한 분양가가 반영되는지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'uiwang_sk_view.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('59A') && el.value.includes('36');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  const balcVal = await page.inputValue('#ta-balc');
  const optVal = await page.inputValue('#ta-opt');
  for (const code of ['36', '45', '59A', '59B', '84A', '84B', '84C']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음');
  }
  if (!priceVal.includes('395,000,000') && !priceVal.includes('395000000')) {
    throw new Error('PDF 자동추출 - 공급금액란에 36타입 17층 분양가(395,000,000) 없음');
  }
  if (!balcVal.includes('7,900,000') && !balcVal.includes('7900000')) {
    throw new Error('PDF 자동추출 - 발코니 확장란에 45타입 확장비(7,900,000) 없음');
  }
  if (!optVal.includes('3,500,000') && !optVal.includes('3500000')) {
    throw new Error('PDF 자동추출 - 옵션란에 36타입 시스템에어컨가(3,500,000) 없음');
  }

  await page.fill('#inp-name', '의왕역 SK VIEW');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '의왕시');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['36', '45', '59A', '59B', '84A', '84B', '84C']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('395,000,000')) throw new Error('36타입 17층 분양가(395,000,000)가 요약 탭에 없음');
  if (!summaryHtml.includes('1,098,000,000')) throw new Error('84C타입 21층이상 분양가(1,098,000,000)가 요약 탭에 없음');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_uiwang.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  // I열(분양가) 어딘가에 36타입 17층 분양가(395,000,000)가 정확히 기록되어 있는지 확인
  let found395 = false, found1098 = false;
  ws.eachRow((row) => {
    const v = row.getCell(9).value; // I열 = 9번째(1-based)
    if (v === 395000000) found395 = true;
    if (v === 1098000000) found1098 = true;
  });
  if (!found395) throw new Error('엑셀 I열에 36타입 17층 분양가(395,000,000) 없음');
  if (!found1098) throw new Error('엑셀 I열에 84C타입 21층이상 분양가(1,098,000,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 의왕역 SK VIEW PDF 첨부 실사례 E2E 통과(엑셀 분양가 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
