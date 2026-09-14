/*
 * 범용성 검증용 스트레스 테스트 (G01~G04)
 *
 * 기존 test_cases_d/e/f.js는 모두 "실제로 확인된" 특정 사례를 그대로 반영한 것이라,
 * 파서가 그 사례들에 맞춰 손질됐을 뿐 정말 일반화됐는지는 증명하지 못한다.
 * 이 파일의 케이스들은 지금까지 본 어떤 실제 사례에도 없던, 의도적으로 새로 지어낸
 * 조합으로 "데이터 자체의 산술 일관성"에 기반한 메커니즘(detectPriceColumnStructure,
 * findAreaTriple)이 특정 헤더 문구나 코드 형식을 몰라도 동작하는지 검증한다.
 */
module.exports = [
  {
    id: 'G01',
    desc: '가격표 헤더에 대지비/건축비/부가세/계약시/입주시 등 인식 키워드가 전혀 없어도(임의 라벨 A~G) 순수 데이터 일관성만으로 구조 인식',
    run: function (p) {
      var priceText = [
        '타입 층 세대 A B C D E F1 F2 F3 F4 F5 F6 G',
        'T05 3층 2 100,000,000 200,000,000 30,000,000 330,000,000 33,000,000 33,000,000 33,000,000 33,000,000 33,000,000 33,000,000 33,000,000 99,000,000',
        'T05 5층 3 105,000,000 205,000,000 31,000,000 341,000,000 34,100,000 34,100,000 34,100,000 34,100,000 34,100,000 34,100,000 34,100,000 102,300,000'
      ].join('\n');
      var price = p.parsePriceSection(priceText, ['T05']);
      var r0 = price.priceRows[0], r1 = price.priceRows[1];
      return price.priceRows.length === 2
        && r0.price === 330000000 && r0.land + r0.build + r0.vat === r0.price && r0.down_payment === 33000000 && r0.balance === 99000000
        && r1.price === 341000000 && r1.units === 3;
    }
  },
  {
    id: 'G02',
    desc: '공급면적: 코드가 면적과 전혀 무관(12B, 12는 라인/호실 번호일 뿐)해도 전용+공용=소계 산술관계로 정확히 판별',
    run: function (p) {
      var area = p.parseAreaSection('12B 59.8000 22.1000 81.9000 17.4000 99.3000 15');
      return area.length === 1 && area[0].code === '12B'
        && area[0].exclusive_area === 59.8 && area[0].supply_area === 81.9 && area[0].supply_units === 15;
    }
  },
  {
    id: 'G03',
    desc: '공급면적: 3단계로 누적되는 면적 체인(전용+공용=소계, 소계+기타공용=계약면적)에서 가장 안쪽 단계를 정확히 선택',
    run: function (p) {
      var area = p.parseAreaSection('55A 45.1234 20.5678 65.6912 12.3088 78.0000 10');
      // 45.1234+20.5678=65.6912(소계), 65.6912+12.3088=78.0000(계약면적) - 더 작은 쪽(소계)을 공급면적으로 선택해야 함
      return area.length === 1 && Math.abs(area[0].supply_area - 65.6912) < 1e-6;
    }
  },
  {
    id: 'G04',
    desc: '옵션가: 지금까지 본 적 없는 새 연속행 라벨("3구성", 숫자+한글 일반형)도 일반화된 CONTINUATION_RE로 이어받아 최소가 채택',
    run: function (p) {
      var option = p.parseOptionSection('99A 3구성 냉장고+세탁기+에어컨 5,500,000\n2구성 냉장고+에어컨 3,200,000', ['99A']);
      return option['99A'] === 3200000;
    }
  }
];
