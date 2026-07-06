/*
 * 실제 공고문 데이터로 브라우저 UI 전체(입력->분석->추가->요약탭)를 검증하는 회귀 E2E 테스트.
 * test_cases_e.js의 실제 텍스트(더폴 울산신정 사례)를 그대로 재사용한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const { TEXT } = require('./test_cases_e.js');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', 'legacy_분양가정리.html'));
  await page.fill('#f-name', '더폴 울산신정');
  await page.selectOption('#f-r1', '경남');
  await page.fill('#f-r2', '울산 남구');
  await page.fill('#in-area', TEXT.AREA_TEXT);
  await page.fill('#in-price', TEXT.PRICE_TEXT);
  await page.fill('#in-balcony', TEXT.BALCONY_TEXT);
  await page.fill('#in-option', TEXT.OPTION_TEXT);

  await page.click('#btn-analyze');
  const status = await page.textContent('#analyze-status');
  console.log('분석 상태:', status);
  if (!status.includes('주택형 2개') || !status.includes('가격행 22건')) {
    throw new Error('분석 결과가 예상과 다름: ' + status);
  }

  await page.click('#btn-add');
  await page.waitForSelector('#view-result.active');
  const summaryHtml = await page.innerHTML('#result-main');
  if (!summaryHtml.includes('84A') || !summaryHtml.includes('84B')) {
    throw new Error('84A/84B 타입이 요약 탭에 보이지 않음');
  }

  if (errors.length) {
    console.log('페이지 에러:', errors);
    throw new Error(errors.length + '건의 에러 발생');
  }

  console.log('✅ 실제 데이터(더폴 울산신정) E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
