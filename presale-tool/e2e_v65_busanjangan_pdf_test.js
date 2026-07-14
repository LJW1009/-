/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 20차 라운드 실사례(부산 장안지구
 * B-2블록 중흥S-클래스 본청약 입주자모집공고, 민영 아파트). 사용자가 직접 업로드한 실제 PDF
 * (fixtures/busan_jangan_b2_jungheungs_class.pdf)를 PDF 첨부 경로로 업로드해, "합계" 행 뒤의
 * 부가 표(주택형 표시 안내/특별공급 공급세대수)가 area 경계를 오염시키지 않는지, 표 중간에 끼어든
 * "■ 공통사항" 안내문 때문에 밀려난 59B 후반부/84A/84B 가격 행이 복구되는지, "천원" 단위 환산이
 * 정확한지, 실제 브라우저 전체 플로우와 엑셀 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'busan_jangan_b2_jungheungs_class.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84B');
  }, { timeout: 20000 });

  const areaVal = await page.inputValue('#ta-area');
  const priceVal = await page.inputValue('#ta-price');
  for (const code of ['59A', '59B', '84A', '84B']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음');
  }
  // 공급금액란은 원문 그대로(단위: 천원) 표시되므로 "468,700"(천원, ×1000 환산은 분석 단계에서
  // 일어남)로 확인한다. 84A/84B는 "■ 공통사항" 삽입으로 표 중간이 끊겼던 부분 - 복구되지 않으면
  // 이 수치 자체가 공급금액란에 아예 없다.
  if (!priceVal.includes('468,700')) {
    throw new Error('PDF 자동추출 - 공급금액란에 84B타입 1층 분양가(468,700천원, 표 중간 끊김 복구분) 없음');
  }
  if (!priceVal.includes('84A') || !priceVal.includes('84B')) {
    throw new Error('PDF 자동추출 - 공급금액란에 84A/84B 타입 자체가 없음(표 중간 끊김 복구 실패)');
  }

  await page.fill('#inp-name', '부산 장안지구 B-2블록 중흥S-클래스');
  await page.selectOption('#inp-r1', '부산광역시');
  await page.fill('#inp-r2', '기장군 장안읍');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  for (const code of ['59A', '59B', '84A', '84B']) {
    if (!chips.includes(code)) throw new Error('PDF 첨부 경로로 분석 시 ' + code + ' 인식 실패: ' + chips);
  }

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  if (!summaryHtml.includes('468,700,000')) throw new Error('84B타입 1층 분양가(468,700,000)가 요약 탭에 없음');
  if (!summaryHtml.includes('353,600,000')) throw new Error('59A타입 1층 분양가(353,600,000)가 요약 탭에 없음');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_busanjangan.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  let found468700000 = false, found353600000 = false;
  ws.eachRow((row) => {
    const v = row.getCell(9).value; // I열 = 분양가
    if (v === 468700000) found468700000 = true;
    if (v === 353600000) found353600000 = true;
  });
  if (!found468700000) throw new Error('엑셀 I열에 84B타입 1층 분양가(468,700,000) 없음 - 표 중간 끊김 복구 실패');
  if (!found353600000) throw new Error('엑셀 I열에 59A타입 1층 분양가(353,600,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 부산 장안지구 B-2블록 중흥S-클래스 PDF 첨부 실사례 E2E 통과(엑셀 분양가 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
