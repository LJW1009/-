/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 다섯 번째 실사례(힐스테이트 둔산 오피스텔).
 * PDF 첨부(fixtures/hillstate_dunsan_officetel.pdf) 경로로 실제 파일을 업로드해, 하이픈 접미사
 * 타입코드(84E1-T 등), 중도금 1차40%+2차10% 불균등분할(상대편차 판정), 콤마+공백으로 분리되는
 * 층 목록("11, 15층") 3가지가 실제 브라우저에서 끝까지 정상 동작하는지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'hillstate_dunsan_officetel.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84E1-T');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  for (const code of ['84A', '84E1', '84E1-T', '84E2', '84E2-T', '84G']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음');
  }
  if (!priceVal.includes('11, 15층')) {
    throw new Error('PDF 자동추출 - 공급금액란에 "11, 15층"(콤마+공백 분리 층 목록) 없음');
  }

  await page.fill('#inp-name', '힐스테이트 둔산 오피스텔');
  await page.selectOption('#inp-r1', '대전광역시');
  await page.fill('#inp-r2', '서구 탄방동');
  await page.selectOption('#inp-kind', '오피스텔');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['84A', '84E1-T', '84E2-T', '84G']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('1,008,000,000')) throw new Error('84E1-T "11, 15층" 분양가(1,008,000,000)가 요약 탭에 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 힐스테이트 둔산 오피스텔 실사례 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
