/*
 * PDF 업로드 기능(텍스트 추출 → 섹션 자동 분리 → 파서) 통합 검증.
 * 브라우저의 handlePdfUpload()/extractPdfFullText()와 동일한 방식(아이템을 그대로 이어붙이고
 * hasEOL에서만 개행 삽입)으로 pdfjs-dist(Node)를 이용해 실제 분양광고 PDF 2건(fixtures/sihwa_mtv_officetel.pdf,
 * test_cases_i.js의 시화MTV 푸르지오 디오션 실사례와 동일 문서 / fixtures/hillstate_dunsan_officetel.pdf,
 * test_cases_j.js의 힐스테이트 둔산 오피스텔 실사례와 동일 문서)를 열어, splitDocumentSections로 자른
 * 결과가 parser.js로 정확히 파싱되는지 확인한다. app_v65_source.html에 삽입된 vendor/pdfjs.min.js와
 * 로직이 같음을 보장하기 위해 굳이 별도 추출 함수를 만들지 않고 이 파일 안에서 동일하게 재구현한다.
 */
const path = require('path');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const parser = require('./parser.js');

async function extractFullText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  let full = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const it of content.items) {
      full += it.str;
      if (it.hasEOL) full += '\n';
    }
    full += '\n';
  }
  return full;
}

async function main() {
  const pdfPath = path.join(__dirname, 'fixtures', 'sihwa_mtv_officetel.pdf');
  const full = await extractFullText(pdfPath);

  let pass = 0, fail = 0;
  const failures = [];
  function check(id, desc, cond) {
    if (cond) pass++; else { fail++; failures.push(id + ': ' + desc); }
  }

  check('P01', 'PDF 텍스트 추출: 최소 분량 이상 추출됨', full.length > 10000);

  const sections = parser.splitDocumentSections(full);
  check('P02', '공급대상 및 공급규모 섹션 앵커 발견', sections.found.area);
  check('P03', '공급금액 및 납부일정 섹션 앵커 발견', sections.found.price);

  const area = parser.parseAreaSection(sections.area);
  const codes = area.map((x) => x.code);
  check('P04', '공급면적 16개 타입 전부 인식(3글자 접미사 65GTB/65GTC/66GTA 포함)',
    area.length === 16 && ['65GTB', '65GTC', '66GTA'].every((c) => codes.includes(c)));

  const ta = area.find((x) => x.code === '53TA');
  check('P05', '53TA 전용/계약면적 정확히 인식', !!ta && ta.exclusive_area === 53.8765 && ta.supply_area === 129.3679);

  const price = parser.parsePriceSection(sections.price, codes);
  const r53ta = price.priceRows.find((r) => r.code === '53TA' && r.floor.raw === '6');
  check('P06', '53TA 6층 분양가/계약금 정확히 인식(586,000,000 / 58,600,000, 계약금 2분할 합산)',
    !!r53ta && r53ta.price === 586000000 && r53ta.down_payment === 58600000);

  const pdfPath2 = path.join(__dirname, 'fixtures', 'hillstate_dunsan_officetel.pdf');
  const full2 = await extractFullText(pdfPath2);
  check('P07', 'PDF 텍스트 추출(힐스테이트 둔산 오피스텔): 최소 분량 이상 추출됨', full2.length > 10000);

  const sections2 = parser.splitDocumentSections(full2);
  check('P08', '공급대상 및 공급규모/공급금액 및 납부일정 섹션 앵커 발견(힐스테이트 둔산 오피스텔)',
    sections2.found.area && sections2.found.price);

  const area2 = parser.parseAreaSection(sections2.area);
  const codes2 = area2.map((x) => x.code);
  check('P09', '공급면적 10개 타입 전부 인식(하이픈 접미사 84E1-T/84E2-T 포함)',
    area2.length === 10 && codes2.includes('84E1-T') && codes2.includes('84E2-T'));

  const price2 = parser.parsePriceSection(sections2.price, codes2);
  const r84a = price2.priceRows.find((r) => r.code === '84A' && r.floor.raw === '4~5층');
  check('P10', '84A 4~5층 계약금/잔금 정확히 인식(중도금 1차40%+2차10% 불균등분할, 상대편차 판정)',
    !!r84a && r84a.down_payment === 47950000 && r84a.balance === 431550000);

  const r84e1t = price2.priceRows.find((r) => r.code === '84E1-T' && r.floor.raw === '11, 15층');
  check('P11', '84E1-T "11, 15층"(콤마+공백 분리 층 목록) 유실 없이 정확히 인식',
    !!r84e1t && r84e1t.floor.kind === 'list' && r84e1t.floor.floors.length === 2
      && r84e1t.floor.floors[0] === 11 && r84e1t.floor.floors[1] === 15 && r84e1t.price === 1008000000);

  console.log(`[test_pdf_extract.js] ${pass}/${pass + fail} 통과`);
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
