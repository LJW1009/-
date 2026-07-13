/*
 * v6.5 기반 산출물(dist/분양가정리.html) 엑셀 다운로드 - 셀 스타일/구조 회귀 테스트.
 *
 * 사용자가 제공한 실제 참고 엑셀(양주 인근 당사매입부지 정리본)을 openpyxl로 직접 뜯어본 뒤
 * 발견한 격차를 고친 결과를 검증한다:
 *   1. SheetJS 커뮤니티판이 셀 스타일(폰트/배경색/테두리)을 파일에 저장하지 않는 문제
 *      (styles.xml에 커스텀 스타일이 전혀 기록되지 않음) -> ExcelJS로 교체
 *   2. 아파트는 공급평수(공급면적 기준), 오피스텔은 전용평수(전용면적 기준)로 평당가
 *      분모가 달라야 하는데 구분 없이 항상 공급면적 기준이었던 문제
 *   3. 같은 평형(약식표기 앞자리 숫자) 여러 타입을 묶은 "OO합계" 그룹 집계 행이 없던 문제
 *   4. 테두리 스타일이 전혀 없던 문제
 * Playwright로 실제 UI에서 엑셀을 다운로드한 뒤, Node의 exceljs로 다시 읽어 스타일/서식/
 * 수식이 실제로 파일에 기록됐는지 확인한다(셀 값만 보는 게 아니라 styles.xml 자체를 검증).
 * 단지 선택 시 해당 단지만 내보내지므로(selId 있으면 그 단지만), 아파트/오피스텔을 각각
 * 선택해 두 번 다운로드한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { TEXT: APT_TEXT } = require('./test_cases_e.js');
const { TEXT: OFFICETEL_TEXT } = require('./test_cases_j.js');

async function downloadAndRead(page, savePath) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  return wb.worksheets[0];
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  // 아파트 사례(더폴 울산신정, 84A/84B 두 타입 - 같은 "84" 평형군이라 그룹 합계 행도 함께 검증)
  await page.fill('#inp-name', '더폴 울산신정');
  await page.selectOption('#inp-r1', '울산광역시');
  await page.fill('#inp-r2', '남구 신정동');
  await page.selectOption('#inp-kind', '아파트');
  await page.fill('#ta-area', APT_TEXT.AREA_TEXT);
  await page.fill('#ta-price', APT_TEXT.PRICE_TEXT);
  await page.fill('#ta-balc', APT_TEXT.BALCONY_TEXT);
  await page.fill('#ta-opt', APT_TEXT.OPTION_TEXT);
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }

  const wsApt = await downloadAndRead(page, path.join(__dirname, 'tmp_excel_style_apt.xlsx'));

  const title = wsApt.getCell('A3');
  check('S01', '단지명 제목: 20pt bold 나눔바른고딕 + 복숭아색 배경 (styles.xml에 실제 기록됨)',
    title.font.bold === true && title.font.size === 20 && title.font.name === '나눔바른고딕'
      && title.fill && title.fill.fgColor && title.fill.fgColor.argb === 'FFECC3B2');

  const hdr = wsApt.getCell('A6');
  check('S02', '컬럼 헤더: bold + 연한 파랑 배경 + 위 medium/아래 thin 테두리',
    hdr.font.bold === true && hdr.fill.fgColor.argb === 'FFDEEBF7'
      && hdr.border.top.style === 'medium' && hdr.border.bottom.style === 'thin');

  check('S03', '아파트 단지: C열(평당가 분모)이 공급면적(B) 기준', wsApt.getCell('C8').value.formula === 'B8*0.3025');

  const sub = wsApt.getCell('A19');
  check('S04', '타입 소계 행: bold + 노란색 배경', sub.font.bold === true && sub.fill.fgColor.argb === 'FFFFFF00');

  const grp = wsApt.getCell('A32');
  check('S05', '같은 평형(84) 그룹 합계 행 "84합계" 존재 + 초록색 배경',
    grp.value === '84합계' && grp.font.bold === true && grp.fill.fgColor.argb === 'FF70AD47');

  const grand = wsApt.getCell('A33');
  check('S06', '전체 합계 행: bold + 하늘색 배경 + 위 thin/아래 medium 테두리(가장 굵은 구분선)',
    grand.value === '합계' && grand.fill.fgColor.argb === 'FF00B0F0'
      && grand.border.top.style === 'thin' && grand.border.bottom.style === 'medium');

  check('S07', '제목 행 높이 45, 헤더 행 높이 47.25 실제 적용', wsApt.getRow(3).height === 45 && wsApt.getRow(6).height === 47.25);
  check('S08', '컬럼 A 너비(13.25) 실제 적용', Math.abs(wsApt.getColumn(1).width - 13.25) < 0.01);

  // 오피스텔 사례(힐스테이트 둔산) - 입력 탭으로 돌아가 새 단지 입력 후 그 단지만 선택해 내보내기
  await page.click('#ntab-inp');
  await page.fill('#inp-name', '힐스테이트 둔산 오피스텔');
  await page.selectOption('#inp-r1', '대전광역시');
  await page.fill('#inp-r2', '서구 탄방동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.fill('#ta-area', OFFICETEL_TEXT.AREA_TEXT);
  await page.fill('#ta-price', OFFICETEL_TEXT.PRICE_TEXT);
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const wsOff = await downloadAndRead(page, path.join(__dirname, 'tmp_excel_style_off.xlsx'));
  const bHdr = wsOff.getCell('B6').value, cHdr = wsOff.getCell('C6').value, dHdr = wsOff.getCell('D6').value;
  check('S09', '오피스텔 헤더 라벨: 계약면적/전용평수/공급호실수', bHdr === '계약\n면적' && cHdr === '전용\n평수' && dHdr === '공급\n호실수');
  check('S10', '오피스텔 단지: C열(평당가 분모)이 전용면적(A) 기준', wsOff.getCell('C8').value.formula === 'A8*0.3025');

  console.log(`[e2e_v65_excel_style_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    await browser.close();
    process.exit(1);
  }
  console.log('\n✅ 엑셀 스타일/구조 회귀 E2E 통과');
  await browser.close();
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
