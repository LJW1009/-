/*
 * 실제 확인된 분양공고 패턴 회귀 테스트 (D01~D24)
 * 사용자가 제공한 "실제 확인된 분양공고 인사이트"의 8개 단지 사례를 반영한다.
 */
module.exports = [
  // ---------- 헤더 컬럼 6패턴: 오프셋은 부가세 유무로만 결정, 합계열 라벨(합계/소계/계)과 무관 ----------
  {
    id: 'D01',
    desc: '패턴A: 대지비 건축비 합계 (부가세 없음, 계약금 비율형) -> offset=2',
    run: function (p) {
      var hdr = p.parseTableHeader('대지비 건축비 합계 계약시 날짜×6 입주시');
      return hdr.offset === 2;
    }
  },
  {
    id: 'D02',
    desc: '패턴B: 대지비 건축비 소계 (부가세 없음, 정액형) -> offset=2',
    run: function (p) {
      var hdr = p.parseTableHeader('대지비 건축비 소계 계약시 날짜×6 입주지정일');
      return hdr.offset === 2;
    }
  },
  {
    id: 'D03',
    desc: '패턴C: 대지비 건축비 부가세 계 (천원단위) -> offset=3',
    run: function (p) {
      var hdr = p.parseTableHeader('(단위: 천원) 대지비 건축비 부가세 계 1차 2차 날짜×6');
      return hdr.offset === 3 && hdr.unit_mult === 1000;
    }
  },
  {
    id: 'D04',
    desc: '패턴D: 대지비 건축비 부가세 소계 (정액 앵커형) -> offset=3',
    run: function (p) {
      var hdr = p.parseTableHeader('대지비 건축비 부가세 소계 계약금 날짜×6 잔금');
      return hdr.offset === 3;
    }
  },
  {
    id: 'D05',
    desc: '패턴F: PDF 복사 오류 "잔금대지비" 글자 붙음 교정 -> offset=3 정상 인식',
    run: function (p) {
      var hdr = p.parseTableHeader('잔금대지비 건축비 부가세 계 날짜×6');
      return hdr.offset === 3;
    }
  },

  // ---------- 타입코드 실제 확인 형식 ----------
  {
    id: 'D06',
    desc: '순수 숫자 코드 (76, 105, 112, 168)',
    run: function (p) {
      var area = p.parseAreaSection('76   59.97   78.12   40\n168   114.85   144.30   20');
      return area.length === 2 && area[0].code === '76' && area[1].code === '168';
    }
  },
  {
    id: 'D07',
    desc: '숫자+O+영문 코드 (84OA~84OH, 오피스텔형)',
    run: function (p) {
      var codes = ['84OA', '84OB'];
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n84OA  5층  10  5,000,000  300,000,000\n84OB  6층  10  5,000,000  305,000,000', codes);
      return price.priceRows.length === 2 && price.priceRows[0].code === '84OA';
    }
  },
  {
    id: 'D08',
    desc: '숫자+영문+숫자 코드 (54A1, 82C2 등)',
    run: function (p) {
      var codes = ['54A1', '82C2'];
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n54A1  3층  10  5,000,000  300,000,000\n82C2  4층  10  5,000,000  320,000,000', codes);
      return price.priceRows.length === 2;
    }
  },
  {
    id: 'D09',
    desc: '대형평수 코드 (114A, 200A)',
    run: function (p) {
      var area = p.parseAreaSection('114A   114.85   144.30   20\n200A   200.12   250.44   4');
      return area.length === 2 && area[0].code === '114A' && Math.abs(area[0].exclusive_area - 114.85) < 1e-6;
    }
  },
  {
    id: 'D10',
    desc: '오피스텔 호형 코드(101A)는 면적과 무관 - 최솟값을 전용면적으로 채택',
    run: function (p) {
      var area = p.parseAreaSection('101A    23.5000    35.2100    30');
      return area[0].exclusive_area === 23.5 && area[0].supply_area === 35.21;
    }
  },

  // ---------- 층구분 실제 확인 형식 ----------
  {
    id: 'D11',
    desc: '공백 포함 범위 "4층~6층"',
    run: function (p) {
      var f = p.parseFloorDesc('4층~6층');
      return f.kind === 'range' && f.min === 4 && f.max === 6;
    }
  },
  {
    id: 'D12',
    desc: '혼합 나열 "6,8~9"',
    run: function (p) {
      var f = p.parseFloorDesc('6,8~9');
      return f.kind === 'mixed' && f.floors.join(',') === '6,8,9';
    }
  },
  {
    id: 'D13',
    desc: '혼합 나열 "10,12~13"',
    run: function (p) {
      var f = p.parseFloorDesc('10,12~13');
      return f.kind === 'mixed' && f.min === 10 && f.max === 13;
    }
  },
  {
    id: 'D14',
    desc: '공백 포함 이상 표기 "41층 이상"',
    run: function (p) {
      var f = p.parseFloorDesc('41층 이상');
      return f.kind === 'above' && f.min === 41;
    }
  },
  {
    id: 'D15',
    desc: '한글 라벨 "고층(16층이상)"',
    run: function (p) {
      var f = p.parseFloorDesc('고층(16층이상)');
      return f.kind === 'above' && f.min === 16 && f.label === '고층';
    }
  },
  {
    id: 'D16',
    desc: '전층 표기',
    run: function (p) {
      var f = p.parseFloorDesc('전층');
      return f.kind === 'all';
    }
  },

  // ---------- 동/호 표기 ----------
  {
    id: 'D17',
    desc: '중점(·) 구분 복수호 "2·3호"',
    run: function (p) {
      var codes = ['084A'];
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  2·3호  5층  10  5,000,000  300,000,000', codes);
      return price.priceRows[0].dong.includes('2') && price.priceRows[0].dong.includes('3호');
    }
  },
  {
    id: 'D18',
    desc: '슬래시 구분 "1호/4호"',
    run: function (p) {
      var codes = ['084A'];
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  1호/4호  5층  10  5,000,000  300,000,000', codes);
      return price.priceRows[0].dong === '1호/4호';
    }
  },

  // ---------- 날짜 형식 ----------
  {
    id: 'D19',
    desc: '2자리 연도 날짜 (24.09.25)',
    run: function (p) {
      var d = p.parseFlexDate('24.09.25');
      return d.getFullYear() === 2024 && d.getMonth() === 8 && d.getDate() === 25;
    }
  },
  {
    id: 'D20',
    desc: '말미 마침표 포함 (2026.10.15.)',
    run: function (p) {
      var d = p.parseFlexDate('2026.10.15.');
      return d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 15;
    }
  },
  {
    id: 'D21',
    desc: '슬래시 구분 날짜 (2026/10/06)',
    run: function (p) {
      var d = p.parseFlexDate('2026/10/06');
      return d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 6;
    }
  },
  {
    id: 'D22',
    desc: '상대일자 "계약 후 30일이내" -> 기준일(baseDate) + 30일',
    run: function (p) {
      var base = new Date(2024, 0, 1);
      var dates = p.extractMidDates('중도금1차 계약 후 30일이내 납부', base);
      var expected = new Date(2024, 0, 31);
      return dates[0] && dates[0].getTime() === expected.getTime();
    }
  },

  // ---------- 계약금: 층마다 다른 비율형 (울산신정), 분납형(5%+5%) ----------
  {
    id: 'D23',
    desc: '계약금 비율이 층마다 다름 (앵커 불가, 헤더기반 필요)',
    run: function (p) {
      var codes = ['084A'];
      var price = p.parsePriceSection([
        '공급금액 및 납부일정 (단위: 원)',
        '084A  1~10층  20  계약금 5%  550,000,000',
        '084A  11~20층  20  계약금 6%  560,000,000'
      ].join('\n'), codes);
      var r1 = price.priceRows[0], r2 = price.priceRows[1];
      return Math.abs(r1.down_ratio - 0.05) < 1e-9 && Math.abs(r2.down_ratio - 0.06) < 1e-9;
    }
  },
  {
    id: 'D24',
    desc: '계약금 2회 분납 비율 (5%+5% = 10%)',
    run: function (p) {
      var codes = ['084A'];
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  5층  10  계약금 5%+5%  550,000,000', codes);
      return Math.abs(price.priceRows[0].down_ratio - 0.10) < 1e-9;
    }
  },

  // ---------- 옵션가: N안형/N대형/기본전실형/묶음형 ----------
  {
    id: 'D25',
    desc: 'N안형: 여러 안 중 최소 개소(최저가) 채택',
    run: function (p) {
      var option = p.parseOptionSection([
        '84O 1안 2 거실+침실1 - 1,400,000',
        '2안 3 거실+침실1+침실2 1,800,000 3,700,000'
      ].join('\n'), ['84O']);
      return option['84O'] === 1400000;
    }
  },
  {
    id: 'D26',
    desc: 'N대형: 여러 대수 중 최소 대수(최저가) 채택',
    run: function (p) {
      var option = p.parseOptionSection('74A 4대 7,270,000\n2대 4,240,000', ['74A']);
      return option['74A'] === 4240000;
    }
  },
  {
    id: 'D27',
    desc: '기본/전실형: 기본(최저가) 채택',
    run: function (p) {
      var option = p.parseOptionSection('84A 기본 거실+주방+침실1 4,800,000\n전실 5개소 6,800,000', ['84A']);
      return option['84A'] === 4800000;
    }
  },
  {
    id: 'D28',
    desc: '묶음형: 여러 코드가 하나의 금액을 공유',
    run: function (p) {
      var option = p.parseOptionSection('76, 84A, 84B, 84C, 84D  4대  2,200,000', ['76', '84A', '84B', '84C', '84D']);
      return option['76'] === 2200000 && option['84C'] === 2200000;
    }
  },

  // ---------- PDF 복사 오염 ----------
  {
    id: 'D29',
    desc: '코드 내부에 공백이 낀 경우 "84 A" 정상 인식',
    run: function (p) {
      var price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n84 A  5층  10  5,000,000  300,000,000', ['84A']);
      return price.priceRows.length === 1 && price.priceRows[0].code === '84A';
    }
  },
  {
    id: 'D30',
    desc: '표 전체가 개행 없이 한 줄로 직렬화된 경우 codes 앵커로 행 분리',
    run: function (p) {
      var codes = ['084A', '084B'];
      var oneLine = '공급금액 및 납부일정 (단위: 원) 084A 5층 10 5,000,000 300,000,000 084B 7층 10 5,000,000 310,000,000';
      var price = p.parsePriceSection(oneLine, codes);
      return price.priceRows.length === 2 && price.priceRows[1].code === '084B' && price.priceRows[1].price === 310000000;
    }
  }
];
