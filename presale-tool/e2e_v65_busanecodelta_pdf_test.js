/*
 * v6.5 기반 산출물(dist/분양가정리.html) 브라우저 종단 테스트 - 21차 라운드 실사례
 * 부산에코델타시티 디에트르 더 퍼스트(28BL) 입주자모집공고문 "정정"(2023.05.12. 원 공고문 중
 * 추가선택사항 옵션품목/마이너스옵션 금액을 정정, 13페이지). 사용자가 직접 업로드한 실제 PDF
 * (fixtures/busan_ecodelta_the_first_28bl_correction.pdf)를 PDF 첨부 경로로 업로드해, "정정
 * 전"/"정정 후" 대조 블록이 앞쪽에 있어도 실제 본문(정정 반영)의 옵션가만 정확히 인식하는지,
 * 공급대상 표가 여러 안내문 뒤로 페이지가 넘어가며 84C/110A/110B/110C 네 행이 가격표 쪽으로
 * 밀려나 있어도 6개 타입 전부와 세대수까지 정확히 복구되는지, 공급금액표가 긴 코드(084.9944A)
 * 로만 표기되어도 정확히 매칭되는지, 엑셀 다운로드 결과까지 검증한다.
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
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'busan_ecodelta_the_first_28bl_correction.pdf'));

  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('110C');
  }, { timeout: 30000 });

  const areaVal = await page.inputValue('#ta-area');
  for (const code of ['84A', '84B', '84C', '110A', '110B', '110C']) {
    if (!areaVal.includes(code)) throw new Error('PDF 자동추출 - 공급면적란에 ' + code + ' 없음: ' + areaVal.slice(0, 300));
  }

  await page.fill('#inp-name', '부산에코델타시티 디에트르 더 퍼스트(28BL)');
  await page.selectOption('#inp-r1', '부산광역시');
  await page.fill('#inp-r2', '강서구 명지동');
  await page.selectOption('#inp-kind', '아파트');

  await page.click('button:has-text("🔍 분석")');
  const chips = await page.textContent('#prev-chips');
  console.log('PDF 첨부 후 분석 칩:', chips.replace(/\s+/g, ' '));
  // 6개 타입 전부 세대수 합계가 표기 세대수와 일치("✓")해야 한다 - 특히 84B/110A/110B/110C는
  // 공급대상 표 재조합(repairFragmentedAreaTable)과 가격표 긴 코드 별칭/괄호 동호 흡수까지
  // 전부 정확해야 통과한다.
  for (const code of ['84A', '84B', '84C', '110A', '110B', '110C']) {
    if (!chips.includes(code + ' ✓')) throw new Error('타입 ' + code + '의 세대수 합계가 표기 세대수와 불일치(또는 인식 실패): ' + chips);
  }
  // "정정 전" 84A 옵션가(7,700,000)가 잘못 채택되지 않고, 실제 본문(정정 반영)의 최저가
  // 800,000이 정확히 반영되어야 한다.
  if (!chips.includes('옵션800,000')) throw new Error('84A 옵션 최저가(800,000, 정정 반영된 실제 본문 값)가 분석 칩에 없음(정정 전 낡은 값 7,700,000이 잘못 채택됐을 가능성): ' + chips);
  if (chips.includes('7,700,000')) throw new Error('"정정 전" 낡은 옵션가(7,700,000)가 분석 칩에 섞여 들어옴: ' + chips);

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const summaryHtml = await page.innerHTML('#tab-summary');
  for (const code of ['84A', '84B', '84C', '110A', '110B', '110C']) {
    if (!summaryHtml.includes(code)) throw new Error(code + ' 타입이 요약 탭에 없음');
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_busanecodelta.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  // 110C 타입의 1층 분양가(628,430,000)와 84B 타입의 1층 분양가(518,840,000)가 엑셀에
  // 정확히 반영됐는지 확인한다(둘 다 공급금액표가 긴 코드로만 표기된 타입).
  let found110C = false, found110C1f = false;
  let found84B = false, found84B1f = false;
  ws.eachRow((row) => {
    const code = row.getCell(5).value; // E열 = 약식표기(타입 코드)
    if (code === '110C') {
      found110C = true;
      if (row.getCell(9).value === 628430000) found110C1f = true; // I열 = 분양가
    }
    if (code === '84B') {
      found84B = true;
      if (row.getCell(9).value === 518840000) found84B1f = true;
    }
  });
  if (!found110C) throw new Error('엑셀 E열(약식표기)에 110C 타입 행 없음');
  if (!found110C1f) throw new Error('엑셀에 110C타입 1층 분양가(628,430,000) 없음');
  if (!found84B) throw new Error('엑셀 E열(약식표기)에 84B 타입 행 없음');
  if (!found84B1f) throw new Error('엑셀에 84B타입 1층 분양가(518,840,000) 없음');

  if (errors.length) {
    console.log('--- 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건 에러 발생');
  }

  console.log('\n✅ 부산에코델타시티 디에트르 더 퍼스트(28BL) 정정 공고문 PDF 첨부 실사례 E2E 통과(정정 전/후 혼동 없음, 6개 타입 세대수/분양가 검증 포함)');
  await browser.close();
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
