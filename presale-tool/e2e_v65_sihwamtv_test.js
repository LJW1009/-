/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 네 번째 실사례(시화MTV 푸르지오 디오션 오피스텔).
 * test_cases_i.js의 실제 텍스트를 재사용해, "소계" 없이 4항목을 더해야 하는 공급면적 구조와
 * 영문 3글자 접미사 타입코드(65GTB 등), 계약금 2분할+중도금 5회 가격구조가 UI에서도 정상 동작하는지 검증한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const { TEXT } = require('./test_cases_i.js');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  await page.fill('#inp-name', '시화MTV 푸르지오 디오션 오피스텔');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '시흥시 정왕동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.fill('#ta-area', TEXT.AREA_TEXT);
  await page.fill('#ta-price', TEXT.PRICE_TEXT);

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['53TA', '65GTB', '65GTC', '66GTA', '119P']) {
    if (!chips.includes(code)) throw new Error(code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('586,000,000')) throw new Error('53TA 6층 분양가(586,000,000)가 요약 탭에 없음');
  if (!summaryHtml.includes('2,111,000,000')) throw new Error('119P 분양가(2,111,000,000)가 요약 탭에 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 시화MTV 푸르지오 디오션 실사례 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
