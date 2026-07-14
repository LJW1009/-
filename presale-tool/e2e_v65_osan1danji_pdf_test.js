/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 20차 라운드 실사례(오산헤리티지자이
 * 1단지 입주자모집공고, 민영 아파트, 2단지의 자매 단지). 사용자가 직접 업로드한 실제 PDF
 * (fixtures/osan_heritage_xi_1danji.pdf)를 PDF 첨부 경로로 업로드해, 2단지에는 없는 84D 타입이
 * 추가로 정확히 인식되는지, "84B,D"(같은 숫자 접두부를 공유하는 코드의 뒤쪽 코드만 남기는 표기)에서
 * 유상옵션 가격이 84B/84D 둘 다에 정확히 반영되는지, 엑셀 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'osan_heritage_xi_1danji.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84D');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  for (const code of ['75', '84A', '84B', '84C', '84D', '102', '124', '166P']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음(2단지에는 없는 84D 포함 8개 타입)');
  }

  await page.fill('#inp-name', '오산헤리티지자이 1단지');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '오산시 양산동');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['75', '84A', '84B', '84C', '84D', '102', '124', '166P']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }
  // "84B,D"(숫자 접두부 생략 나열) 표기에서 84D도 84B와 동일한 유상옵션 최저가(5,960,000)를 가져야 한다.
  const chipsAfter84D = chips.slice(chips.indexOf('84D'));
  if (!chipsAfter84D.includes('5,960,000')) throw new Error('84D 옵션가(5,960,000, "84B,D" 접두부 생략 표기)가 분석 칩에 없음: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('84D')) throw new Error('84D 타입이 요약 탭에 없음');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_osan1danji.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  let found84D = false, found84D2f = false;
  ws.eachRow((row) => {
    const code = row.getCell(5).value; // E열 = 약식표기(타입 코드)
    if (code === '84D') {
      found84D = true;
      if (row.getCell(9).value === 746000000) found84D2f = true; // I열 = 분양가(84D 2층)
    }
  });
  if (!found84D) throw new Error('엑셀 E열(약식표기)에 84D 타입 행 없음');
  if (!found84D2f) throw new Error('엑셀에 84D타입 2층 분양가(746,000,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 오산헤리티지자이 1단지 PDF 첨부 실사례 E2E 통과(엑셀 84D 타입 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
