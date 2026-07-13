/*
 * v6.5 기반 산출물(dist/분양가정리.html) - PDF 첨부 경로 메타 인식 + 중도금 이자 계산 회귀 테스트.
 *
 * 사용자가 "전체 프로세스를 다시 확인해달라"고 요청해 실제 PDF로 브라우저 전체 플로우를
 * 처음부터 끝까지(PDF 첨부→분석→추가→요약→수정→엑셀 다운로드) 재검증하는 과정에서
 * 발견한 두 가지 회귀:
 *   1. 오픈일/입주예정일이 PDF 첨부 경로에서 항상 "미인식"으로 나왔다. extractMeta가
 *      공급금액/공급면적 입력란 텍스트만 검색했는데, 이 문서처럼 공고일/입주예정일
 *      문구가 그 두 섹션 밖(예: "■ ...로 분양신고", "■ 준공 및 입주예정일 : ...")에
 *      있으면 어디에도 안 걸린다. 직접 붙여넣기 경로는 사용자가 보통 그 문구까지 함께
 *      넓게 복사해서 우연히 통과했을 뿐, PDF 자동 추출처럼 섹션 경계를 정확히 지키면
 *      항상 실패하는 구조적 결함이었다.
 *   2. 중도금 회차가 6회가 아니면(이 문서는 2회) 이자 계산이 통째로 0으로 나왔다
 *      (mid_dates.length===6이 아니면 null로 버려짐). 게다가 회차별 이자 계산 자체도
 *      "분양가의 10%"로 가정하는 열 오프셋 버그(55+i+1, 1차 회차가 금리 칸과 겹쳐 모든
 *      회차가 한 칸씩 밀림)와 잘못된 원금 가정(회차별 실제 금액 대신 항상 10%)이 겹쳐
 *      있어, 6회 문서라도 결과가 틀렸을 수 있었다.
 */
const { chromium } = require('playwright');
const path = require('path');
const ExcelJS = require('exceljs');

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(__dirname, 'dist', '분양가정리.html'));

  const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'hillstate_dunsan_officetel.pdf'));
  await page.waitForFunction(() => {
    const el = document.getElementById('ta-area');
    return el && el.value.includes('84E1-T');
  }, { timeout: 20000 });

  await page.fill('#inp-name', '힐스테이트 둔산 오피스텔');
  await page.selectOption('#inp-r1', '대전광역시');
  await page.fill('#inp-r2', '서구 탄방동');
  await page.selectOption('#inp-kind', '오피스텔');
  await page.click('button:has-text("🔍 분석")');

  const chips = await page.textContent('#prev-chips');
  console.log('분석 칩:', chips.replace(/\s+/g, ' '));

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) { if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); } }

  check('M01', 'PDF 첨부 경로에서도 오픈일이 인식됨(공급면적/공급금액 섹션 밖 문구)', chips.includes('오픈일 2025.08.18'));
  check('M02', 'PDF 첨부 경로에서도 입주예정월이 인식됨', chips.includes('2026년9월'));

  await page.click('button:has-text("➕ 추가")');
  await page.waitForSelector('#pg-res.on');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("⬇️ 엑셀 다운로드")'),
  ]);
  const savePath = path.join(__dirname, 'tmp_meta_interest_test.xlsx');
  await download.saveAs(savePath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(savePath);
  const fs = require('fs');
  fs.unlinkSync(savePath);
  const ws = wb.worksheets[0];

  check('M03', '오픈일이 엑셀에도 반영됨', ws.getCell('A4').value === '오픈일 : 2025.08.18');

  // 84A 4~5층 행(8행) - 실제 중도금 1차 383,600,000원(2025-10-30, 306일)/2차 95,900,000원
  // (2025-12-30, 245일), 금리 5% 기준. 열 오프셋 버그 수정 전에는 BD(56)/BE(57)에 값이
  // 어긋나 있었고, 원금도 항상 "분양가*10%"로 잘못 가정했다.
  check('M04', '금리(BD6)가 헤더 행에 정상 기록(이전엔 본문 회차 이자 수식이 이 칸을 침범)', ws.getCell('BD6').value === 0.05);
  check('M05', '1차 중도금 날짜(BE6)/일수(BE7) 정상 기록', ws.getCell('BE6').value instanceof Date && ws.getCell('BE7').value === 306);
  check('M06', '2차 중도금 날짜(BF6)/일수(BF7) 정상 기록(3차 이후는 빈 칸)',
    ws.getCell('BF6').value instanceof Date && ws.getCell('BF7').value === 245 && ws.getCell('BG6').value == null);

  const beFormula = ws.getCell('BE8').value && ws.getCell('BE8').value.formula;
  const bfFormula = ws.getCell('BF8').value && ws.getCell('BF8').value.formula;
  check('M07', '1차 중도금 이자 수식이 실제 원금(383,600,000, 분양가의 10% 가정이 아님)과 자기 날짜(BE$7)를 정확히 참조',
    beFormula === '(383600000*$BD$6)*(BE$7/365)');
  check('M08', '2차 중도금 이자 수식이 실제 원금(95,900,000)과 자기 날짜(BF$7)를 정확히 참조(더 이상 한 칸씩 밀리지 않음)',
    bfFormula === '(95900000*$BD$6)*(BF$7/365)');
  check('M09', '중도금 2회뿐인 문서도 이자가 0으로 버려지지 않음(6회 미만이면 통째로 무시하던 버그 수정)',
    ws.getCell('BE8').value.formula !== '(0*$BD$6)*(BE$7/365)');

  console.log(`[e2e_v65_meta_interest_fix_test.js] ${pass}/${pass + fail} 통과`);
  if (errors.length) { console.log('--- 브라우저 에러 ---'); errors.forEach((e) => console.log(e)); }
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    await browser.close();
    process.exit(1);
  }
  console.log('\n✅ PDF 첨부 메타 인식 + 중도금 이자 계산 회귀 E2E 통과');
  await browser.close();
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
