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
  // 18차: 단지명 제목 배경색이 종류별로 갈림(오피스텔=자주/강조4 40% 밝게, 아파트=주황/강조6 40% 밝게).
  check('S01', '아파트 단지명 제목: 20pt bold 나눔바른고딕 + 주황(강조6 40% 밝게) 배경 (styles.xml에 실제 기록됨)',
    title.font.bold === true && title.font.size === 20 && title.font.name === '나눔바른고딕'
      && title.fill && title.fill.fgColor && title.fill.fgColor.argb === 'FFFAC090');

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

  check('S07', '제목 행 높이 45, 헤더 행 높이 35.25 실제 적용', wsApt.getRow(3).height === 45 && wsApt.getRow(6).height === 35.25);
  check('S08', '컬럼 A 너비(21) 실제 적용', Math.abs(wsApt.getColumn(1).width - 21) < 0.01);

  // 계약 1~5일차/청약일정 등(구 AC~AK, 계약 진행 현황) 열은 삭제되어 존재하지 않는다.
  check('S11', '계약 일차/청약일정 등 열이 삭제됨(AC6에 더 이상 "계약" 라벨이 없음)',
    wsApt.getCell('AC6').value == null);
  // 중도금 이자 계산 표(금리/회차별 날짜)는 이제 청약 현황 블록(1~28열) 바로 옆(AE~AL)에 위치한다.
  check('S12', '중도금 이자 계산 표가 AE(금리)~AL(입주일) 위치로 이동', wsApt.getCell('AE6').value === 0 || typeof wsApt.getCell('AE6').value === 'number');
  check('S13', '입주일이 AL6에 기록됨', wsApt.getCell('AL6').value instanceof Date);
  // 표 전체 높이를 관통하는 좌우 구획선: T(특공당해)열 왼쪽 medium, AB(비고)열 오른쪽 medium.
  check('S14', 'T열(특공당해) 왼쪽 medium 구획선이 헤더~합계 행까지 이어짐',
    wsApt.getCell('T6').border.left.style === 'medium' && wsApt.getCell('T8').border.left.style === 'medium'
      && wsApt.getCell('T33').border.left.style === 'medium');
  check('S15', 'AB열(비고) 오른쪽 medium 구획선이 헤더~합계 행까지 이어짐',
    wsApt.getCell('AB6').border.right.style === 'medium' && wsApt.getCell('AB8').border.right.style === 'medium'
      && wsApt.getCell('AB33').border.right.style === 'medium');

  // 18차: 소계/평형합계/합계 행은 값이 없는 칸(B~G 등)도 A~S 전체에 배경색+테두리가
  // 끊김 없이 이어져야 한다(중간이 비어보이는 "줄무늬" 문제 방지).
  check('S16', '소계 행이 B~G(값 없는 칸)까지 노란 배경으로 끊김 없이 채워짐',
    ['B','C','D','E','F','G'].every(c => wsApt.getCell(c + '19').fill?.fgColor?.argb === 'FFFFFF00'));
  check('S17', '평형합계 행이 B~G까지 초록 배경으로 끊김 없이 채워짐',
    ['B','C','D','E','F','G'].every(c => wsApt.getCell(c + '32').fill?.fgColor?.argb === 'FF70AD47'));
  check('S18', '합계 행이 B~G까지 하늘색 배경으로 끊김 없이 채워짐',
    ['B','C','D','E','F','G'].every(c => wsApt.getCell(c + '33').fill?.fgColor?.argb === 'FF00B0F0'));
  // 소계 행도 평형합계/합계처럼 평당가 분모(C열, 전용/공급평수)를 채운다(한 타입 안에서는
  // 상수이므로 가중평균 대신 그 타입 첫 행의 C열을 그대로 참조).
  check('S19', '소계 행에 평당가 분모(C열, 전용/공급평수) 값이 채워짐(이전엔 빈 칸)',
    wsApt.getCell('C19').value && wsApt.getCell('C19').value.formula === 'C8');
  // 경쟁률 칸(AA) 등 청약현황 블록 중간(21~27열)도 소계/합계 행에서 위/아래 테두리가 이어짐.
  check('S20', '경쟁률(AA) 칸 아래에도 합계 행 테두리가 이어짐(더 이상 빈 칸으로 끊기지 않음)',
    wsApt.getCell('AA19').border.top?.style === 'thin' && wsApt.getCell('AA19').border.bottom?.style === 'thin');
  // 모든 셀이 가로/세로 가운데 정렬(ExcelJS는 세로 가운데를 'center'가 아니라 'middle'로
  // 써야 실제로 styles.xml에 기록된다 - 'center'를 쓰면 조용히 무시되는 함정이 있었음).
  check('S21', '데이터 셀이 가로+세로 모두 가운데 정렬(vertical=middle)로 저장됨',
    wsApt.getCell('A8').alignment.horizontal === 'center' && wsApt.getCell('A8').alignment.vertical === 'middle');
  check('S22', '제목 셀도 세로 가운데 정렬(vertical=middle)로 저장됨',
    wsApt.getCell('A3').alignment.vertical === 'middle');

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
  check('S23', '오피스텔 단지명 제목: 자주(강조4 40% 밝게) 배경',
    wsOff.getCell('A3').fill?.fgColor?.argb === 'FFB3A2C7');

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
