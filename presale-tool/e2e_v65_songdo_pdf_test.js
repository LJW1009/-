/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 여섯 번째 실사례(더샵 송도그란테르
 * G5-3블록 오피스텔). 사용자가 "공급면적을 인식 못한다"고 제보한 실제 PDF(fixtures/songdo_g53_officetel.pdf)를
 * PDF 첨부 경로로 업로드해, pdf.js 텍스트 재구성 순서가 어긋나 공급면적표 본문이 공급금액 섹션
 * 앞부분에 섞여 들어가는 문제를 splitDocumentSections의 단위표기(㎡/원) 2차 경계 복구로
 * 해결했는지, 그리고 "▣ 별도계약 - 추가 선택품목" 옵션 섹션 앵커도 실제 브라우저에서 끝까지
 * 정상 동작하는지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'songdo_g53_officetel.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84OA');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  for (const code of ['84OA', '84OB', '84OC', '84OD', '84OE', '84OF', '84OG', '84OH']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음(공급면적표 복구 실패)');
  }
  if (!priceVal.includes('84OA')) throw new Error('PDF 자동추출 - 공급금액란에 84OA 없음');

  await page.fill('#inp-name', '더샵 송도그란테르 G5-3블록 오피스텔');
  await page.selectOption('#inp-r1', '인천광역시');
  await page.fill('#inp-r2', '연수구 송도동');
  await page.selectOption('#inp-kind', '오피스텔');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['84OA', '84OB', '84OC', '84OD', '84OE', '84OF', '84OG', '84OH']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('630,000,000')) throw new Error('84OA 5층 분양가(630,000,000)가 요약 탭에 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 더샵 송도그란테르 G5-3블록 오피스텔 PDF 첨부 실사례 E2E 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
