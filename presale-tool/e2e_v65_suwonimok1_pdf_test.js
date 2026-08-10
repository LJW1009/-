/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 21차 라운드 실사례
 * 북수원이목지구 대방 디에트르 더 리체Ⅰ(A4BL) 입주자모집공고문(원본, 13페이지, 2024.09, 민영
 * 아파트). 사용자가 직접 업로드한 실제 PDF(fixtures/suwon_imok_detree_riche1_a4bl.pdf)를
 * PDF 첨부 경로로 업로드해, "■ 공급금액 표"(짧은 형태의 가격 섹션 헤딩)와 "(단위 : ㎡...)"
 * 표기 없이 통째로 가격 섹션 쪽에 놓인 공급대상 표, "최상층"처럼 층 표기와 세대수 숫자가
 * 괄호로 묶인 동/호 설명 때문에 서로 다른 줄에 떨어진 행까지 전부 정확히 인식되는지, 엑셀
 * 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'suwon_imok_detree_riche1_a4bl.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84C');
  }, { timeout: 30000 });

  const areaVal = await page.inputValue('#ta-area');
  for (const code of ['84B', '84C']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음: ' + areaVal.slice(0, 300));
  }

  await page.fill('#inp-name', '북수원이목지구 대방 디에트르 더 리체Ⅰ(A4BL)');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '수원시 장안구 이목동');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['84B', '84C']) {
    if (!chips.includes(code + ' ✓')) throw new Error('타입 ' + code + '의 세대수 합계가 표기 세대수와 불일치(또는 인식 실패): ' + chips);
  }
  if (!chips.includes('확장비7,470,000') && !chips.includes('확장비 7,470,000')) throw new Error('84B 발코니 확장비(7,470,000)가 분석 칩에 없음: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  for (const code of ['84B', '84C']) {
    if (!summaryHtml.includes(code)) throw new Error(code + ' 타입이 요약 탭에 없음');
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_suwonimok1.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  // 84C 타입의 "최상층(107동 2,3호, 108동 1,2호)" 행(4세대, 1,405,020,000원)이 엑셀에
  // 정확히 반영됐는지 확인한다 - 층 표기와 세대수 숫자가 괄호 안 동/호 설명 때문에 서로
  // 다른 줄에 떨어져 있던 행이라 실패하기 가장 쉬운 케이스다.
  let found84CTop = false;
  ws.eachRow((row) => {
    const code = row.getCell(5).value; // E열 = 약식표기(타입 코드)
    if (code === '84C' && row.getCell(9).value === 1405020000) found84CTop = true; // I열 = 분양가
  });
  if (!found84CTop) throw new Error('엑셀에 84C타입 "최상층(107동 2,3호, 108동 1,2호)" 행의 분양가(1,405,020,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 북수원이목지구 대방 디에트르 더 리체Ⅰ(A4BL) PDF 첨부 실사례 E2E 통과(줄바꿈 병합/짧은 가격 앵커 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
