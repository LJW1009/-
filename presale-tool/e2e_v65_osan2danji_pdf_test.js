/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 20차 라운드 실사례(오산헤리티지자이
 * 2단지 입주자모집공고, 민영 아파트). 사용자가 직접 업로드한 실제 PDF
 * (fixtures/osan_heritage_xi_2danji.pdf)를 PDF 첨부 경로로 업로드해, 대분류 제목에 "■"/"▣"
 * 불릿이 전혀 없이 줄 시작 문구("공급대상 및 면적"/"공급대금 및 납부일정")만으로 된 문서도
 * 실제 브라우저에서 정상 인식되는지, "구분(약식표기) 코드나열" 열-정렬 카탈로그 발코니 확장비
 * 표가 헤더-데이터 위치 대응으로 복구되는지, 엑셀 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'osan_heritage_xi_2danji.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('166P');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  const balcVal = await page.inputValue('#ta-balc');
  for (const code of ['75', '84A', '84B', '84C', '102', '124', '166P']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출(불릿 없는 대분류 제목) - 공급면적란에 ' + code + ' 없음');
  }
  if (!priceVal.includes('850,100,000') && !priceVal.includes('850100000')) {
    throw new Error('PDF 자동추출 - 공급금액란에 102타입 2층 분양가(850,100,000, VAT 실값 포함) 없음');
  }
  if (!balcVal.includes('17,700,000') && !balcVal.includes('17700000')) {
    throw new Error('PDF 자동추출 - 발코니 확장란에 75타입 확장비(17,700,000, 열-정렬 카탈로그) 없음');
  }

  await page.fill('#inp-name', '오산헤리티지자이 2단지');
  await page.selectOption('#inp-r1', '경기도');
  await page.fill('#inp-r2', '오산시 양산동');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['75', '84A', '84B', '84C', '102', '124', '166P']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }
  if (!chips.includes('17,700,000')) throw new Error('75타입 발코니 확장비(17,700,000)가 분석 칩에 없음: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('850,100,000')) throw new Error('102타입 2층 분양가(850,100,000)가 요약 탭에 없음');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_osan2danji.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  let found = false;
  ws.eachRow((row) => {
    const v = row.getCell(9).value; // I열 = 분양가
    if (v === 850100000) found = true;
  });
  if (!found) throw new Error('엑셀 I열에 102타입 2층 분양가(850,100,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 오산헤리티지자이 2단지 PDF 첨부 실사례 E2E 통과(엑셀 분양가 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
