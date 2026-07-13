/*
 * PDF 업로드 기능(텍스트 추출 → 섹션 자동 분리 → 파서) 통합 검증.
 * 브라우저의 handlePdfUpload()/extractPdfFullText()와 동일한 방식(아이템을 그대로 이어붙이고
 * hasEOL에서만 개행 삽입)으로 pdfjs-dist(Node)를 이용해 실제 분양광고 PDF 3건(fixtures/sihwa_mtv_officetel.pdf,
 * test_cases_i.js의 시화MTV 푸르지오 디오션 실사례와 동일 문서 / fixtures/hillstate_dunsan_officetel.pdf,
 * test_cases_j.js의 힐스테이트 둔산 오피스텔 실사례와 동일 문서 / fixtures/songdo_g53_officetel.pdf,
 * test_cases_k.js의 더샵 송도그란테르 G5-3블록 오피스텔 실사례와 동일 문서)를 열어,
 * splitDocumentSections로 자른 결과가 parser.js로 정확히 파싱되는지 확인한다. app_v65_source.html에
 * 삽입된 vendor/pdfjs.min.js와 로직이 같음을 보장하기 위해 굳이 별도 추출 함수를 만들지 않고 이
 * 파일 안에서 동일하게 재구현한다.
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

  const opt2 = parser.parseOptionSection(sections2.option, codes2);
  check('P11b', '옵션 섹션이 "추가선택 옵션품목 납부계좌" 이후 유의사항 산문까지 섞여 들어가지 않아, 그 산문 속 우연한 타입코드 언급("84A,B,C,D,E타입")이 84A 옵션가로 오인되지 않음',
    sections2.option.indexOf('납부계좌') === -1 && opt2['84A'] === undefined);

  const pdfPath3 = path.join(__dirname, 'fixtures', 'songdo_g53_officetel.pdf');
  const full3 = await extractFullText(pdfPath3);
  check('P12', 'PDF 텍스트 추출(더샵 송도그란테르 G5-3블록 오피스텔): 최소 분량 이상 추출됨', full3.length > 10000);

  const sections3 = parser.splitDocumentSections(full3);
  check('P13', '공급대상 및 공급규모/공급금액 및 납부일정 섹션 앵커 발견(송도그란테르 G5-3)',
    sections3.found.area && sections3.found.price);

  const area3 = parser.parseAreaSection(sections3.area);
  const codes3 = area3.map((x) => x.code);
  check('P14', '공급면적 8개 타입 전부 인식(pdf.js 재배치로 표 본문이 공급금액 섹션 앞부분에 섞여 들어간 문서를, 단위표기(㎡/원) 2차 경계로 복구)',
    area3.length === 8 && codes3.includes('84OA') && codes3.includes('84OH'));

  const price3 = parser.parsePriceSection(sections3.price, codes3);
  const r84oa = price3.priceRows.find((r) => r.code === '84OA' && r.floor.raw === '5층');
  check('P15', '84OA 5층 분양가/계약금/잔금 정확히 인식(공급면적표 복구 후 남은 price 섹션이 온전함)',
    !!r84oa && r84oa.price === 630000000 && r84oa.down_payment === 63000000 && r84oa.balance === 189000000);

  console.log(`[test_pdf_extract.js] ${pass}/${pass + fail} 통과`);
  if (failures.length) {
    console.log('--- 실패 목록 ---');
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
