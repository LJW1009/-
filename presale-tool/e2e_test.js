const { chromium } = require('playwright');
const path = require('path');

const SAMPLE_AREA = [
  '공급면적 및 공급규모',
  '관리번호   주택형        전용면적(㎡)   공급면적(㎡)   공급세대수',
  '101        084.9750A     84.9750        109.5432       120',
  '102        059.9700B     59.9700        78.1234        60'
].join('\n');

const SAMPLE_PRICE = [
  '공급금액 및 납부일정 (단위: 원)  대지비 건축비 합계',
  '중도금1차(2024.06.10) 중도금2차(2024.09.10) 중도금3차(2024.12.10)',
  '중도금4차(2025.03.10) 중도금5차(2025.06.10) 중도금6차(2025.09.10)',
  '084.9750A  1~4층  40  10,000,000  550,000,000',
  '084.9750A  5~9층  80  10,000,000  560,000,000',
  '059.9700B  전체     60  8,000,000  420,000,000'
].join('\n');

const SAMPLE_BALCONY = '084.9750A   14,500,000\n059.9700B   9,800,000';
const SAMPLE_OPTION = '084.9750A   3,200,000\n059.9700B   2,100,000';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  const filePath = 'file://' + path.join(__dirname, 'dist', 'legacy_분양가정리.html');
  await page.goto(filePath);

  await page.fill('#f-name', '테스트단지');
  await page.selectOption('#f-r1', '경기');
  await page.fill('#f-r2', '수원시');
  await page.fill('#in-area', SAMPLE_AREA);
  await page.fill('#in-price', SAMPLE_PRICE);
  await page.fill('#in-balcony', SAMPLE_BALCONY);
  await page.fill('#in-option', SAMPLE_OPTION);

  await page.click('#btn-analyze');
  const status = await page.textContent('#analyze-status');
  console.log('분석 상태:', status);
  if (!status.includes('주택형 2개')) throw new Error('분석 결과가 예상과 다름: ' + status);

  await page.click('#btn-add');
  await page.waitForSelector('#view-result.active');

  const treeText = await page.textContent('#unit-tree');
  console.log('트리:', treeText.replace(/\s+/g, ' ').trim());
  if (!treeText.includes('테스트단지')) throw new Error('사이드바 트리에 단지가 나타나지 않음');

  // 요약 탭 확인
  const summaryHtml = await page.innerHTML('#result-main');
  if (!summaryHtml.includes('084.9750A') || !summaryHtml.includes('059.9700B')) {
    throw new Error('요약 탭에 주택형 데이터가 보이지 않음');
  }
  console.log('요약 탭: 주택형 렌더링 확인됨');

  // 데이터 수정 탭
  await page.click('button[data-sub="edit"]');
  const editHtml = await page.innerHTML('#subview-body');
  if (!editHtml.includes('<input')) throw new Error('수정 탭에 인라인 입력 필드가 없음');
  console.log('수정 탭: 인라인 편집 필드 확인됨');

  // 원본 입력 탭
  await page.click('button[data-sub="raw"]');
  const rawHtml = await page.innerHTML('#subview-body');
  if (!rawHtml.includes('084.9750A')) throw new Error('원본 탭에 원본 텍스트가 없음');
  console.log('원본 탭: 원본 텍스트 확인됨');

  // JSON 내보내기 (다운로드 트리거 확인)
  const [download1] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-save-json')
  ]);
  console.log('JSON 다운로드 파일명:', download1.suggestedFilename());

  // 엑셀 다운로드
  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-excel')
  ]);
  console.log('엑셀 다운로드 파일명:', download2.suggestedFilename());
  const savePath = path.join(__dirname, '/tmp_e2e_output.xlsx');
  await download2.saveAs(savePath);
  console.log('엑셀 파일 저장됨:', savePath);

  if (errors.length) {
    console.log('--- 콘솔/페이지 에러 ---');
    errors.forEach((e) => console.log(e));
    throw new Error(errors.length + '건의 에러 발생');
  }

  console.log('\n✅ E2E 테스트 전체 통과');
  await browser.close();
})().catch((e) => {
  console.error('❌ E2E 테스트 실패:', e.message);
  process.exit(1);
});
