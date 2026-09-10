/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 세 번째 실사례(고양창릉 S-4블록).
 * test_cases_h.js의 실제 텍스트를 재사용해, 그룹코드 안의 하위타입 분리·세대수 없는
 * 기본형/마이너스옵션 행·대지비 분리 없는 가격구조까지 UI에서 정상 동작하는지 검증한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const { TEXT } = require('./test_cases_h.js');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  await page.fill('#inp-name', '고양창릉 S-4블록 공공분양주택');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '고양시 창릉동');
  await page.selectOption('#inp-kind', '아파트');
  await page.fill('#ta-area', TEXT.AREA_TEXT);
  await page.fill('#ta-price', TEXT.PRICE_TEXT);
  await page.fill('#ta-balc', TEXT.BALCONY_TEXT);

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['59AL', '59A', '59AH']) {
    if (!chips.includes(code)) throw new Error(code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('608,570,000') && !summaryHtml.includes('608570000')) {
    throw new Error('59AL 3층 기본형 분양가(608,570,000)가 요약 탭에 없음');
  }
  if (!summaryHtml.includes('마이너스옵션')) throw new Error('마이너스옵션 행이 요약 탭에 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 고양창릉 실사례 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
