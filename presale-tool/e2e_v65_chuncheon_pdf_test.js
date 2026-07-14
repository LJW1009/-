/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 20차 라운드 실사례(춘천 리버뷰
 * 아이파크 입주자모집공고, 민영 아파트). 사용자가 직접 업로드한 실제 PDF
 * (fixtures/chuncheon_riverview_ipark.pdf)를 PDF 첨부 경로로 업로드해, "1) 시스템에어컨
 * 2) 가전 3) 인테리어/기타"처럼 번호 매김 소제목으로 나뉜 다항목 옵션 섹션에서 서로 다른
 * 품목(오븐/욕실스타일링업 등)의 최저가가 섞이지 않고 첫 소제목만 정확히 반영되는지, 실제
 * 브라우저 전체 플로우와 엑셀 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'chuncheon_riverview_ipark.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84B');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const optVal = await page.inputValue('#ta-opt');
  for (const code of ['59A', '59B', '84A', '84B']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음');
  }
  // 시스템에어컨(첫 소제목) 최솟값이 있어야 하며, 뒤섞이면 안 되는 오븐/욕실스타일링업 최저가(550,000/560,000)가
  // 84A/59A 최솟값으로 대체되지 않아야 한다(옵션란 자체는 원문 그대로라 최종 min 계산 전이므로 값 포함 여부만 확인).
  if (!optVal.includes('3,660,000')) throw new Error('PDF 자동추출 - 옵션란에 59A타입 시스템에어컨 최저가(3,660,000) 없음');

  await page.fill('#inp-name', '춘천 리버뷰 아이파크');
  await page.selectOption('#inp-r1', '강원특별자치도');
  await page.fill('#inp-r2', '춘천시');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['59A', '59B', '84A', '84B']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }
  // 분석 단계에서 옵션 최솟값이 정확히 계산되었는지(다항목 카탈로그의 다른 품목 최저가가 섞이지 않았는지) 확인
  if (!chips.includes('3,660,000')) throw new Error('59A 옵션가(3,660,000, 시스템에어컨)가 분석 칩에 없음: ' + chips);
  if (!chips.includes('5,450,000')) throw new Error('84A 옵션가(5,450,000, 시스템에어컨)가 분석 칩에 없음: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('356,000,000')) throw new Error('59A타입 1층 분양가(356,000,000)가 요약 탭에 없음');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_chuncheon.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  let found356 = false;
  ws.eachRow((row) => {
    const v = row.getCell(9).value; // I열 = 분양가
    if (v === 356000000) found356 = true;
  });
  if (!found356) throw new Error('엑셀 I열에 59A타입 1층 분양가(356,000,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 춘천 리버뷰 아이파크 PDF 첨부 실사례 E2E 통과(엑셀 분양가 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
