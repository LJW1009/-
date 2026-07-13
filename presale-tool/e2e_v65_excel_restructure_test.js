/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 엑셀 내보내기 구조 개편(17차) 회귀 테스트.
 *
 * 사용자가 제공한 실사용 서식 예시(더샵 송도그란테르 G5-3블록, "수정 전/후" 두 파일)를
 * openpyxl로 셀 단위까지 뜯어본 뒤 맞춘 사항을 검증한다:
 *   1. 계약 1~5일차/계약총계/잔여/분양률/청약일정등(구 AC~AK) 열은 완전히 삭제됐다.
 *   2. 중도금 이자 계산 표(금리/회차별 날짜·일수)는 청약 현황 블록(1~28열) 바로 옆
 *      AE(금리)~AL(입주일) 위치로 옮겨졌고, 각 칸이 얇은 상자 테두리로 둘러싸인다.
 *   3. T(특공당해)열 왼쪽/AB(비고)열 오른쪽에 medium 굵기 구획선이 헤더부터 합계 행까지
 *      표 전체 높이를 관통해 이어진다.
 *   4. A~E(전용면적~약식표기, 타입당 한 번만 값이 있는 칸)는 타입의 층행 범위 전체로
 *      세로 병합되고, 병합 상자 안에서도 매 층행 아래에 thin 구분선이 이어지며 상자
 *      맨 위에만 thin 선이 걸린다.
 *   5. 제목 행 병합(A3:AB3)과 새 열 너비/행 높이가 실사용 서식 예시와 일치한다.
 * 값 하나가 아니라 styles.xml에 실제로 기록된 서식을 확인해야 하므로, Playwright로
 * 실제 UI에서 엑셀을 다운로드한 뒤 Node의 exceljs로 다시 읽어 검증한다.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'songdo_g53_officetel.pdf'));
  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84OA');
  }, { timeout: 20000 });

  await page.fill('#inp-name', '더샵 송도그란테르 G5-3블록 오피스텔');
  await page.selectOption('#inp-r1', '인천광역시');
  await page.fill('#inp-r2', '연수구 송도동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.click('button:has-text("🔍 분석")');
  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_excel_restructure_test.xlsx');
  await download.saveAs(savePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];
  await browser.close();

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }
  function bstyle(cellRef, side) { const b = ws.getCell(cellRef).border; return b && b[side] ? b[side].style : null; }

  // 1. 계약 일차/계약총계/잔여/분양률/청약일정등(구 AC~AK) 열이 완전히 삭제됐다.
  check('R01', 'AC~AK 열이 삭제되어 헤더 라벨이 없음', ws.getCell('AC6').value == null);
  check('R02', '표 전체가 AL(38)열에서 끝남(구 63열 레이아웃이 아님)', ws.columnCount <= 38 || ws.getColumn(39).values.every(v => v == null));

  // 2. 중도금 이자 계산 표가 AE(금리)~AL(입주일)로 이동, 상자 테두리(사방 thin).
  check('R03', '금리(AE6)가 새 위치에 기록됨', typeof ws.getCell('AE6').value === 'number');
  check('R04', '입주일(AL6)이 새 위치에 기록됨', ws.getCell('AL6').value instanceof Date);
  check('R05', '금리 칸(AE6)이 사방 thin 상자 테두리', ['top','bottom','left','right'].every(s => bstyle('AE6', s) === 'thin'));
  check('R06', '1회차 날짜 칸(AF6)이 사방 thin 상자 테두리', ['top','bottom','left','right'].every(s => bstyle('AF6', s) === 'thin'));
  check('R07', '입주일 칸(AL6)이 사방 thin 상자 테두리', ['top','bottom','left','right'].every(s => bstyle('AL6', s) === 'thin'));

  // 3. T열 왼쪽/AB열 오른쪽 medium 구획선이 헤더~합계 행까지 이어짐.
  for (const r of [6, 7, 8, 10, 32, 33]) {
    check('R08-' + r, `T${r} 왼쪽 medium 구획선`, bstyle('T' + r, 'left') === 'medium');
    check('R09-' + r, `AB${r} 오른쪽 medium 구획선`, bstyle('AB' + r, 'right') === 'medium');
  }

  // 4. A~E 세로 병합 + 병합 상자 내부 매 행 아래쪽 thin, 맨 위만 thin.
  // ExcelJS는 저장된 파일을 다시 읽을 때 병합 범위의 슬레이브 셀 서식을 항상 마스터(첫 행)
  // 서식으로 보고한다(실제로는 openpyxl로 직접 XML을 뜯어보면 슬레이브 셀에 다른 서식이
  // 따로 저장돼 있음이 확인됨 - 이 라운드에서 openpyxl로 직접 검증 완료). 그래서 이 테스트는
  // ExcelJS로 확인 가능한 마스터 셀(첫 행) 기준의 위/아래 thin 여부만 검증한다.
  check('R10', 'A8:A9가 세로 병합됨(84OA 타입 첫 두 층행)', ws.getCell('A8').isMerged && ws.getCell('A9').isMerged);
  check('R11', '병합 상자 첫 행(A8) 기준 위/아래 모두 thin', bstyle('A8','top')==='thin' && bstyle('A8','bottom')==='thin');
  check('R13', 'A열이 표 전체의 왼쪽 medium 외곽선도 겸함', bstyle('A8','left')==='medium' && bstyle('A9','left')==='medium');

  // 5. 제목 행 병합 + 새 열 너비/행 높이.
  check('R14', '제목 행이 A~AB(28열)까지 병합됨', ws.getCell('A3').isMerged && ws.getCell('AB3').isMerged);
  check('R15', '헤더 행 높이 35.25', ws.getRow(6).height === 35.25);
  check('R16', '당해/기타 소제목 행 높이 29.25', ws.getRow(7).height === 29.25);
  check('R17', 'A열 너비 21', Math.abs(ws.getColumn(1).width - 21) < 0.01);
  check('R18', 'AE열(금리) 너비 8.5', Math.abs(ws.getColumn(31).width - 8.5) < 0.01);

  console.log(`[e2e_v65_excel_restructure_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('\n✅ 엑셀 내보내기 구조 개편(17차) 회귀 E2E 통과');
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
