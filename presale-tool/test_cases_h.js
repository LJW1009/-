/*
 * 실제 공고문 원문 회귀 테스트 (H01~H06) - 고양창릉 S-4블록 공공분양주택.
 * 이전 사례들과는 다른 새로운 실패 패턴을 반영한다:
 *   - "059.0000A" 같은 긴 그룹코드 하나에 실제로는 서로 다른 짧은형 하위타입(59AL/59A/59AH,
 *     각기 면적·세대수가 다름)이 1:1이 아니라 여러 개 딸려 있음
 *   - 가격표에 대지비/건축비 분리 표기가 아예 없고 "주택가격" 한 컬럼뿐이며, 잔금 뒤에
 *     융자금(주택도시기금)처럼 추가 컬럼이 하나 더 있음
 *   - 세대수 컬럼 자체가 없고, 같은 층 안에서 "기본형"/"마이너스옵션" 두 가격이 나열됨
 *     (마이너스옵션 쪽은 자신의 층 토큰 없이 바로 이어짐)
 *   - 층구분이 "5층~ 최상층"처럼 공백을 두고 두 토큰에 걸쳐 표기됨
 *   - 발코니 섹션의 연속행 라벨이 지금까지 본 적 없는 새 단어("마이너스옵션")
 */
var PRICE_TEXT = [
  '■ 분양가격 납부조건 등 안내',
  ' [단위 : 천원]',
  '주택형(주택타입) 세부평형 층별 구분 주택가격 계약금10% 1차중도금10% 2차중도금10% 3차중도금10% 4차중도금10% 5차중도금10% 6차중도금10% 잔금 융자금(주택도시기금)',
  '계약시 (’27.05.12.) (’27.11.10.) (’28.05.10.) (‘28.11.08.) (’29.04.11.) (‘29.09.12.) 입주시',
  '059.0000A',
  '59AL',
  '3층',
  '기본형 608,570 60,857 60,857 60,857 60,857 60,857 60,857 60,857 127,571 55,000',
  '마이너스옵션 577,130 57,713 57,713 57,713 57,713 57,713 57,713 57,713 118,139 55,000',
  '4층',
  '기본형 621,120 62,112 62,112 62,112 62,112 62,112 62,112 62,112 131,336 55,000',
  '마이너스옵션 589,680 58,968 58,968 58,968 58,968 58,968 58,968 58,968 121,904 55,000',
  '5층~ 최상층',
  '기본형 627,400 62,740 62,740 62,740 62,740 62,740 62,740 62,740 133,220 55,000',
  '마이너스옵션 595,960 59,596 59,596 59,596 59,596 59,596 59,596 59,596 123,788 55,000',
  '59A',
  '1층',
  '기본형 589,650 58,965 58,965 58,965 58,965 58,965 58,965 58,965 121,895 55,000',
  '마이너스옵션 558,215 55,821 55,821 55,821 55,821 55,821 55,821 55,821 112,468 55,000',
  '59AH',
  '1층',
  '기본형 590,040 59,004 59,004 59,004 59,004 59,004 59,004 59,004 122,012 55,000',
  '마이너스옵션 559,717 55,971 55,971 55,971 55,971 55,971 55,971 55,971 112,920 55,000'
].join('\n');

var AREA_TEXT = [
  '059.0000A',
  '59AL 59.96 22.9836 6.4736 40.2759 129.6931 확장 19.44 52.3508 8',
  '59A 59.95 22.9797 6.4725 40.2692 129.6714 확장 19.44 52.3420 297',
  '59AH 59.99 22.9951 6.4767 40.2960 129.7578 확장 19.44 52.3769 238'
].join('\n');

var BALCONY_TEXT = [
  '[단위 : 천원]',
  '59AL 59A 59AH 기본형 5,453 545 545 545 545 545 545 545 1,638',
  '마이너스옵션 4,635 463 463 463 463 463 463 463 1,394'
].join('\n');

module.exports = [
  {
    id: 'H01',
    desc: '실사례 공급면적: 긴 그룹코드(059.0000A) 하나에 딸린 서로 다른 짧은형 하위타입 3개(59AL/59A/59AH)가 뭉개지지 않고 각자의 면적·세대수로 분리 인식',
    run: function (p) {
      var area = p.parseAreaSection(AREA_TEXT);
      var al = area.find(function (x) { return x.code === '59AL'; });
      var a = area.find(function (x) { return x.code === '59A'; });
      var ah = area.find(function (x) { return x.code === '59AH'; });
      return area.length === 3
        && al && al.exclusive_area === 59.96 && al.supply_units === 8
        && a && a.exclusive_area === 59.95 && a.supply_units === 297
        && ah && ah.exclusive_area === 59.99 && ah.supply_units === 238;
    }
  },
  {
    id: 'H02',
    desc: '실사례 가격표: 대지비/건축비 분리표기 없이 "주택가격" 한 컬럼 + 잔금 뒤 융자금 추가컬럼도 정확히 인식(가격/계약금 10%)',
    run: function (p) {
      var codes = ['59AL', '59A', '59AH'];
      var price = p.parsePriceSection(PRICE_TEXT, codes);
      var r0 = price.priceRows[0];
      return r0.price === 608570000 && r0.down_payment === 60857000
        && Math.abs(r0.down_payment - Math.round(r0.price * 0.1)) <= 1000;
    }
  },
  {
    id: 'H03',
    desc: '실사례 가격표: 세대수 컬럼 없이 같은 층에서 "기본형"/"마이너스옵션" 두 가격이 나열(마이너스옵션은 자신의 층 토큰 없이 이어짐) - 10개 행 전부 인식',
    run: function (p) {
      var codes = ['59AL', '59A', '59AH'];
      var price = p.parsePriceSection(PRICE_TEXT, codes);
      var basic = price.priceRows.filter(function (r) { return r.dong === '기본형'; });
      var minus = price.priceRows.filter(function (r) { return r.dong === '마이너스옵션'; });
      return price.priceRows.length === 10 && basic.length === 5 && minus.length === 5
        && minus[0].floor.raw === basic[0].floor.raw; // 마이너스옵션이 직전 층을 이어받음
    }
  },
  {
    id: 'H04',
    desc: '실사례 가격표: 공백을 두고 두 토큰에 걸친 층구분("5층~ 최상층")도 하나의 층으로 인식',
    run: function (p) {
      var codes = ['59AL'];
      var price = p.parsePriceSection(PRICE_TEXT, codes);
      var r = price.priceRows.find(function (x) { return x.floor.raw === '5층~ 최상층'; });
      return !!r && r.price === 627400000;
    }
  },
  {
    id: 'H05',
    desc: '실사례 가격표: 라벨 없이 나열된 6개 날짜(2027.05.12~2029.09.12) 정확히 추출',
    run: function (p) {
      var codes = ['59AL'];
      var price = p.parsePriceSection(PRICE_TEXT, codes);
      var d0 = price.midDates[0], d5 = price.midDates[5];
      return d0 && d0.getFullYear() === 2027 && d0.getMonth() === 4 && d0.getDate() === 12
        && d5 && d5.getFullYear() === 2029 && d5.getMonth() === 8 && d5.getDate() === 12;
    }
  },
  {
    id: 'H06',
    desc: '실사례 발코니: 지금까지 본 적 없는 새 연속행 라벨("마이너스옵션")도 특정 단어 목록 없이 일반화된 규칙(순수 한글 라벨)으로 인식해 최소가 채택',
    run: function (p) {
      var codes = ['59AL', '59A', '59AH'];
      var balcony = p.parseBalconySection(BALCONY_TEXT, codes);
      return balcony['59AL'] === 4635000 && balcony['59A'] === 4635000 && balcony['59AH'] === 4635000;
    }
  }
];

module.exports.TEXT = { PRICE_TEXT: PRICE_TEXT, AREA_TEXT: AREA_TEXT, BALCONY_TEXT: BALCONY_TEXT };
