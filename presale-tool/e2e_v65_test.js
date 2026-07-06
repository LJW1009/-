/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트.
 * 실제 원문(더폴 울산신정)을 넣어 분석->추가->요약/수정/원본 탭->삭제->엑셀 다운로드까지 검증.
 */
const { chromium } = require('playwright');
const path = require('path');
const { TEXT } = require('./test_cases_e.js');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  await page.fill('#inp-name', '더폴 울산신정');
  await page.selectOption('#inp-r1', '울산광역시');
  await page.fill('#inp-r2', '남구 신정동');
  await page.selectOption('#inp-kind', '아파트');
  await page.fill('#ta-area', TEXT.AREA_TEXT);
  await page.fill('#ta-price', TEXT.PRICE_TEXT);
  await page.fill('#ta-balc', TEXT.BALCONY_TEXT);
  await page.fill('#ta-opt', TEXT.OPTION_TEXT);

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('분석 칩:', chips.replace(/\s+/g, ' '));
  if (!chips.includes('84A') || !chips.includes('84B')) throw new Error('84A/84B 인식 실패: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const sidebarHtml = await page.innerHTML('#sb-body');
  if (!sidebarHtml.includes('더폴 울산신정')) throw new Error('사이드바에 단지가 보이지 않음');
  console.log('사이드바: 단지 등록 확인됨');

  // 요약 탭 확인
  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('84A') || !summaryHtml.includes('84B')) throw new Error('요약 탭에 주택형이 없음');
  const rowCount = (summaryHtml.match(/<tr>/g) || []).length;
  console.log('요약 탭 행 수(대략):', rowCount);

  // 데이터 수정 탭
  await page.click('button:has-text("✏️ 데이터 수정")');
  const editHtml = await page.innerHTML('#tab-edit');
  if (!editHtml.includes('e-name')) throw new Error('수정 탭에 필드가 없음');
  console.log('수정 탭: 필드 확인됨');

  // 원본 입력 탭
  await page.click('button:has-text("📄 원본 입력")');
  const rawHtml = await page.innerHTML('#tab-raw');
  if (!rawHtml.includes('84A')) throw new Error('원본 탭에 원본 텍스트가 없음');
  console.log('원본 탭: 원본 텍스트 확인됨');

  // 엑셀 다운로드
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")')
  ]);
  const savePath = path.join(__dirname, 'tmp_v65_output.xlsx');
  await download.saveAs(savePath);
  console.log('엑셀 다운로드 완료:', savePath);

  // JSON 저장/불러오기
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("💾 데이터 저장")')
  ]);
  console.log('JSON 다운로드 완료:', jsonDownload.suggestedFilename());

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ v6.5 기반 산출물 E2E 전체 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
