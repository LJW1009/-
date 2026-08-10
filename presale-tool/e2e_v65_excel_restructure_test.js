/*
 * v6.5 기반 산출물(dist/분양가정리.html) - 엑셀 내보내기 전면 재작성(22차) 회귀 테스트.
 *
 * 사용자가 실사용 서식 예시(양주5,6차 인근 당사매입부지 정리본, 의정부역 센트럴 아이파크 등
 * 5개 단지가 담긴 시트)를 제공하며 "이후 분양광고를 올렸을 때 동일한 형태로 결과물이
 * 나오게" 엑셀 내보내기를 다시 만들라고 요청해 openpyxl로 셀 단위까지 뜯어본 뒤 반영한
 * 구조를 검증한다(자세한 내용은 README.md "엑셀 내보내기 스타일/구조 > 22차" 참고):
 *   1. 청약 현황 블록(구 T~AB, 특별공급/1·2순위/합계/경쟁률/비고/청약일정등)은 완전히
 *      삭제됐다(사용자가 스크린샷으로 직접 삭제 범위를 지정).
 *   2. 중도금 이자 계산 표는 메인 표(1~19열) 바로 옆 V(금리)~AC(입주) 위치로 옮겨졌고,
 *      그 위 행(5행)에 금리/중도금N차/입주 라벨이 별도로 붙는다.
 *   3. 표 전체가 촘촘한 격자(모든 칸 얇은 테두리)이고 A열 왼쪽/S열 오른쪽에만 굵은
 *      외곽선이 있다. I~S(금액 열)는 오른쪽 정렬, A~H는 가운데 정렬.
 *   4. A~E(전용면적~약식표기)는 타입의 층행 범위 전체로 세로 병합되며, 병합 상자
 *      안에서는 위쪽 thin이 타입 첫 행에만, 아래쪽은 전혀 걸리지 않는다(다음 행/소계의
 *      위쪽 선이 경계를 대신함).
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

  // 1. 청약 현황 블록(구 T~AB)이 완전히 삭제됐다 - 메인 표는 S(19)열에서 끝나고,
  // S와 이자 계산 표(V~AC) 사이(T,U=20,21열)는 완전히 빈 칸이다.
  check('R01', '헤더가 S(19)열에서 끝남(구 특별공급/비고/청약일정등 열 없음)',
    ws.getCell('S6').value === '총\n평당가' && ws.getCell('T6').value == null && ws.getCell('U6').value == null);
  check('R02', 'S열 오른쪽에 표 전체를 관통하는 medium 외곽선', bstyle('S6', 'right') === 'medium' && bstyle('S33', 'right') === 'medium');

  // 2. 중도금 이자 계산 표가 V(금리)~AC(입주)로 이동, 그 위(5행)에 라벨이 별도로 붙는다.
  check('R03', '금리(V6)가 새 위치에 기록됨', typeof ws.getCell('V6').value === 'number');
  check('R04', '입주일(AC6)이 새 위치에 기록됨', ws.getCell('AC6').value instanceof Date);
  check('R05', '이자 계산 표 라벨 행(5행)에 금리/중도금1차/입주 라벨', ws.getCell('V5').value === '금리' && ws.getCell('W5').value === '중도금1차' && ws.getCell('AC5').value === '입주');
  check('R06', '금리 칸(V6)이 사방 thin 상자 테두리', ['top','bottom','left','right'].every(s => bstyle('V6', s) === 'thin'));
  check('R07', '1회차 날짜 칸(W6)이 사방 thin 상자 테두리', ['top','bottom','left','right'].every(s => bstyle('W6', s) === 'thin'));
  check('R08', '회차별 일수(W7)가 "$AC$6-W6" 형태의 실시간 수식', ws.getCell('W7').value && ws.getCell('W7').value.formula === '$AC$6-W6');

  // 3. 표 전체가 촘촘한 격자 + 금액 열(I~S) 오른쪽 정렬, A~H 가운데 정렬.
  check('R09', '데이터 셀(G8~H8)이 사방 thin 격자', ['top','bottom','left','right'].every(s => bstyle('G8', s) === 'thin'));
  check('R10', '금액 열(I8) 오른쪽 정렬', ws.getCell('I8').alignment.horizontal === 'right');
  check('R11', '층별 열(G8) 가운데 정렬', ws.getCell('G8').alignment.horizontal === 'center');
  check('R12', '헤더 라벨(I6)은 금액 열이라도 가운데 정렬', ws.getCell('I6').alignment.horizontal === 'center');

  // 4. A~E 세로 병합: 위쪽 thin은 타입 첫 행에만, 아래쪽은 전혀 없음(다음 행이 경계 역할).
  // ExcelJS는 저장된 파일을 다시 읽을 때 병합 범위의 슬레이브 셀 서식을 항상 마스터(첫 행)
  // 서식으로 보고하므로(실제 XML에는 슬레이브 셀에 다른 서식이 따로 저장돼 있음 - 이전
  // 라운드에서 openpyxl로 직접 검증 완료), 마스터 셀(A8) 기준 위/아래만 확인한다.
  check('R13', 'A8:A9가 세로 병합됨(84OA 타입 두 층행)', ws.getCell('A8').isMerged && ws.getCell('A9').isMerged);
  check('R14', '병합 상자 첫 행(A8) 기준 위쪽만 thin(아래쪽 없음)', bstyle('A8','top')==='thin' && bstyle('A8','bottom')==null);
  check('R16', 'A열이 표 전체의 왼쪽 medium 외곽선을 겸함', bstyle('A8','left')==='medium');

  // 5. 제목 행 병합(A~AC) + 열 너비/행 높이 + 단지명 배경색.
  check('R17', '제목 행이 A~AC(29열, 이자 계산 표까지 포함)까지 병합됨', ws.getCell('A3').isMerged && ws.getCell('AC3').isMerged);
  check('R18', '헤더 행 높이 47.25, 회차별 일수 행 높이 34.9', ws.getRow(6).height === 47.25 && ws.getRow(7).height === 34.9);
  check('R19', 'A열 너비 13.25', Math.abs(ws.getColumn(1).width - 13.25) < 0.01);
  check('R20', '단지명 제목 배경색(복숭아색, 종류 구분 없이 동일)', ws.getCell('A3').fill.fgColor.argb === 'FFECC3B2');

  console.log(`[e2e_v65_excel_restructure_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('\n✅ 엑셀 내보내기 전면 재작성(22차) 회귀 E2E 통과');
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
