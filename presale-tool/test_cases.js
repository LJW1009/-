/*
 * 기본 단위 테스트 (A1~A7: 개별 섹션 파서), (B1~B11: 가격 섹션 헤더/층구분/계약금 변형)
 * 합계 18개
 */
module.exports = [
  // ---------------- A. 개별 파서 기본 동작 ----------------
  {
    id: 'A1',
    desc: '공급면적: 아파트형(관리번호 포함)',
    fn: 'parseAreaSection',
    input: [
      '공급면적 및 공급규모',
      '관리번호   주택형        전용면적(㎡)   공급면적(㎡)   공급세대수',
      '101        084.9750A     84.9750        109.5432       120',
      '102        084.9852B     84.9852        110.1235       45'
    ].join('\n'),
    expect: [
      { code: '084.9750A', exclusive_area: 84.9750, supply_area: 109.5432, supply_units: 120 },
      { code: '084.9852B', exclusive_area: 84.9852, supply_area: 110.1235, supply_units: 45 }
    ]
  },
  {
    id: 'A2',
    desc: '공급면적: 오피스텔형(호형)',
    fn: 'parseAreaSection',
    input: [
      '공급면적 및 공급규모',
      '호형    전용면적(㎡)   공급면적(㎡)   공급세대수',
      '101A    23.5000        35.2100        30'
    ].join('\n'),
    expect: [
      { code: '101A', exclusive_area: 23.5000, supply_area: 35.2100, supply_units: 30 }
    ]
  },
  {
    id: 'A3',
    desc: '공급면적: 면적먼저형(전용면적이 먼저, 코드가 뒤)',
    fn: 'parseAreaSection',
    input: [
      '공급면적 및 공급규모',
      '전용면적(㎡)   주택형        공급면적(㎡)   공급세대수',
      '59.9700        059.9700A     78.1234        88'
    ].join('\n'),
    expect: [
      { code: '059.9700A', exclusive_area: 59.9700, supply_area: 78.1234, supply_units: 88 }
    ]
  },
  {
    id: 'A4',
    desc: '발코니 확장비: 원 단위',
    fn: 'parseBalconySection',
    args: [['084.9750A', '084.9852B']],
    input: [
      '발코니 확장비 (단위: 원)',
      '084.9750A   14,500,000',
      '084.9852B   15,200,000'
    ].join('\n'),
    expect: { '084.9750A': 14500000, '084.9852B': 15200000 }
  },
  {
    id: 'A5',
    desc: '발코니 확장비: 천원 단위',
    fn: 'parseBalconySection',
    args: [['084.9750A']],
    input: [
      '발코니 확장비 (단위: 천원)',
      '084.9750A   14,500'
    ].join('\n'),
    expect: { '084.9750A': 14500000 }
  },
  {
    id: 'A6',
    desc: '에어컨 옵션가',
    fn: 'parseOptionSection',
    args: [['101A']],
    input: [
      '시스템에어컨 옵션가 (단위: 원)',
      '101A   3,200,000'
    ].join('\n'),
    expect: { '101A': 3200000 }
  },
  {
    id: 'A7',
    desc: '메타정보: 공고일 / 입주예정월',
    fn: 'extractMeta',
    input: '입주자 모집공고일: 2024.03.10   입주예정월: 2026년 5월',
    expectFn: function (r) {
      return r.open_date && r.open_date.getFullYear() === 2024 && r.open_date.getMonth() === 2 && r.open_date.getDate() === 10
        && r.move_in_year === 2026 && r.move_in_month === 5;
    }
  },

  // ---------------- B. 가격 섹션 헤더/층구분/계약금 변형 ----------------
  {
    id: 'B1',
    desc: '단위 감지: 원',
    fn: 'parsePriceSection',
    args: [['084.9750A']],
    input: '공급금액 및 납부일정 (단위: 원)\n084.9750A  5층  120  350,000,000',
    expectFn: function (r) { return r.unit_mult === 1; }
  },
  {
    id: 'B2',
    desc: '단위 감지: 천원',
    fn: 'parsePriceSection',
    args: [['084.9750A']],
    input: '공급금액 및 납부일정 (단위: 천원)\n084.9750A  5층  120  350,000',
    expectFn: function (r) { return r.unit_mult === 1000 && r.priceRows[0].price === 350000000; }
  },
  {
    id: 'B3',
    desc: '합계 오프셋: 대지비+건축비 (부가세 없음, offset=2)',
    fn: 'parsePriceSection',
    args: [['084.9750A']],
    input: '공급금액 및 납부일정 (단위: 원)  대지비 건축비 합계\n084.9750A  5층  120  350,000,000',
    expectFn: function (r) { return r.priceRows.length === 1; }
  },
  {
    id: 'B4',
    desc: '합계 오프셋: 대지비+건축비+부가세 (offset=3)',
    fn: 'parsePriceSection',
    args: [['084.9750A']],
    input: '공급금액 및 납부일정 (단위: 원)  대지비 건축비 부가가치세 합계\n084.9750A  5층  120  350,000,000',
    expectFn: function (r) { return r.priceRows.length === 1; }
  },
  {
    id: 'B5',
    desc: '층구분: 단일층 "5층"',
    fn: 'parseFloorDesc',
    input: '5층',
    expect: { raw: '5층', kind: 'exact', min: 5, max: 5, label: '' }
  },
  {
    id: 'B6',
    desc: '층구분: 범위 "5~9층"',
    fn: 'parseFloorDesc',
    input: '5~9층',
    expect: { raw: '5~9층', kind: 'range', min: 5, max: 9, label: '' }
  },
  {
    id: 'B7',
    desc: '층구분: 콤마리스트 "5,7,9"',
    fn: 'parseFloorDesc',
    input: '5,7,9',
    expect: { raw: '5,7,9', kind: 'list', floors: [5, 7, 9], min: 5, max: 9, label: '' }
  },
  {
    id: 'B8',
    desc: '층구분: 이상 "20층이상"',
    fn: 'parseFloorDesc',
    input: '20층이상',
    expect: { raw: '20층이상', kind: 'above', min: 20, max: Infinity, label: '' }
  },
  {
    id: 'B9',
    desc: '층구분: 이하 "5층이하"',
    fn: 'parseFloorDesc',
    input: '5층이하',
    expect: { raw: '5층이하', kind: 'below', min: 1, max: 5, label: '' }
  },
  {
    id: 'B10',
    desc: '층구분: 라벨포함 "저층(3~5층)"',
    fn: 'parseFloorDesc',
    input: '저층(3~5층)',
    expect: { raw: '저층(3~5층)', kind: 'range', min: 3, max: 5, label: '저층' }
  },
  {
    id: 'B11',
    desc: '계약금: 정액 vs 비율(%) 모두 지원',
    fn: 'parsePriceSection',
    args: [['084.9750A', '084.9852B']],
    input: [
      '공급금액 및 납부일정 (단위: 원)',
      '084.9750A  5층  120  10,000,000  350,000,000',
      '084.9852B  9층  45   계약금 10%  360,000,000'
    ].join('\n'),
    expectFn: function (r) {
      var a = r.priceRows.filter(function (x) { return x.code === '084.9750A'; })[0];
      var b = r.priceRows.filter(function (x) { return x.code === '084.9852B'; })[0];
      return a && !a.down_is_ratio && a.down_payment === 10000000
        && b && b.down_is_ratio && Math.abs(b.down_ratio - 0.10) < 1e-9;
    }
  }
];
