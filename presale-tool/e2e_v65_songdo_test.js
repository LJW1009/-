/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 두 번째 실사례(더샵 송도그란테르).
 * test_cases_f.js의 실제 텍스트를 그대로 재사용해 8개 타입 x 2개 층 = 16개 가격행 인식을 검증한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const { TEXT } = require('./test_cases_f.js');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  await page.fill('#inp-name', '더샵 송도그란테르 G5-3블록 오피스텔');
  await page.selectOption('#inp-r1', '인천광역시');
  await page.fill('#inp-r2', '연수구 송도동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.fill('#ta-area', TEXT.AREA_TEXT);
  await page.fill('#ta-price', TEXT.PRICE_TEXT);

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['84OA', '84OB', '84OC', '84OD', '84OE', '84OF', '84OG', '84OH']) {
    if (!chips.includes(code)) throw new Error(code + ' 인식 실패: ' + chips);
  }
  if (!chips.includes('중도금 6/6')) throw new Error('중도금 날짜 인식 실패: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  for (const code of ['84OA', '84OH']) {
    if (!summaryHtml.includes(code)) throw new Error(code + ' 요약 탭에 없음');
  }
  // 84OA 5층 데이터가 정확히 렌더링되는지 확인 (630,000,000원)
  if (!summaryHtml.includes('630,000,000')) throw new Error('84OA 5층 분양가(630,000,000)가 요약 탭에 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 송도그란테르 실사례 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
