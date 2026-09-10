/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - "PDF 첨부" 기능 자체를 검증.
 * 실제 파일 입력(#file input[type=file])에 실사례 PDF(fixtures/sihwa_mtv_officetel.pdf)를
 * 첨부해, pdf.js(vendor/pdfjs.min.js, client-side) 텍스트 추출 → splitDocumentSections
 * 섹션 자동 분리 → 4개 입력란 자동 채움 → 분석까지 전체 파이프라인이 실제 브라우저에서
 * 동작하는지 확인한다(test_pdf_extract.js는 같은 파이프라인을 Node에서 검증, 이 파일은
 * 실제 UI 클릭/파일첨부 경로까지 포함해 검증).
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'sihwa_mtv_officetel.pdf'));

  // 추출은 비동기(pdf.js)이므로 공급면적 입력란이 채워질 때까지 대기
  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('53TA');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  for (const code of ['53TA', '65GTB', '65GTC', '66GTA', '119P']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음');
  }
  if (!priceVal.includes('586,000,000') && !priceVal.includes('586000000')) {
    throw new Error('PDF 자동추출 - 공급금액란에 53TA 6층 분양가(586,000,000) 없음');
  }

  await page.fill('#inp-name', '시화MTV 푸르지오 디오션 오피스텔');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '시흥시 정왕동');
  await page.selectOption('#inp-kind', '오피스텔');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['53TA', '65GTB', '65GTC', '66GTA', '119P']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ PDF 첨부 자동인식 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
