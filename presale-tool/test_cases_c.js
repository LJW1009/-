/*
 * 통합/엣지 케이스 (C01~C30, 30개)
 * 실제 문서에서 발생 가능한 변형(동/라인 열, 탭 구분, 불규칙 공백, 코드 형식 등)을 검증한다.
 */
module.exports = [
  {
    id: 'C01',
    desc: '아파트형 통합: 면적+가격+발코니+옵션+메타',
    run: function (p) {
      const area = p.parseAreaSection([
        '공급면적 및 공급규모',
        '관리번호   주택형        전용면적(㎡)   공급면적(㎡)   공급세대수',
        '101        084.9750A     84.9750        109.5432       120'
      ].join('\n'));
      const codes = area.map(a => a.code);
      const price = p.parsePriceSection([
        '공급금액 및 납부일정 (단위: 원)  대지비 건축비 합계',
        '084.9750A  5층  120  10,000,000  350,000,000'
      ].join('\n'), codes);
      const balcony = p.parseBalconySection('084.9750A   14,500,000', codes);
      const option = p.parseOptionSection('084.9750A   3,200,000', codes);
      const meta = p.extractMeta('공고일: 2024.03.10 입주예정월: 2026년 5월');
      return area.length === 1 && price.priceRows.length === 1 &&
        balcony['084.9750A'] === 14500000 && option['084.9750A'] === 3200000 &&
        meta.move_in_year === 2026;
    }
  },
  {
    id: 'C02',
    desc: '오피스텔형 통합',
    run: function (p) {
      const area = p.parseAreaSection('호형    전용면적(㎡)   공급면적(㎡)   공급세대수\n101A    23.5000        35.2100        30');
      const codes = area.map(a => a.code);
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n101A  전체  30  5,000,000  150,000,000', codes);
      return area[0].code === '101A' && price.priceRows[0].code === '101A';
    }
  },
  {
    id: 'C03',
    desc: '면적먼저형 통합 (전용면적이 코드보다 먼저)',
    run: function (p) {
      const area = p.parseAreaSection('전용면적(㎡)   주택형        공급면적(㎡)   공급세대수\n59.9700        059.9700A     78.1234        88');
      return area.length === 1 && area[0].code === '059.9700A' && area[0].exclusive_area === 59.9700;
    }
  },
  {
    id: 'C04',
    desc: '코드가 순수 숫자.소수(문자 없음)인 경우도 가격 섹션에서 codes 매칭으로 인식',
    run: function (p) {
      const codes = ['059.9700'];
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n059.9700  5층  88  8,000,000  300,000,000', codes);
      return price.priceRows.length === 1 && price.priceRows[0].code === '059.9700';
    }
  },
  {
    id: 'C05',
    desc: '층구분: 정확한 단일층이 여러 코드에 걸쳐 각각 파싱됨',
    run: function (p) {
      const codes = ['084A', '084B'];
      const price = p.parsePriceSection([
        '공급금액 및 납부일정 (단위: 원)',
        '084A  3층  10  5,000,000  300,000,000',
        '084B  7층  10  5,000,000  310,000,000'
      ].join('\n'), codes);
      const a = price.priceRows.find(r => r.code === '084A');
      const b = price.priceRows.find(r => r.code === '084B');
      return a.floor.min === 3 && a.floor.max === 3 && b.floor.min === 7 && b.floor.max === 7;
    }
  },
  {
    id: 'C06',
    desc: '층구분: 범위 "5~9층"',
    run: function (p) {
      const f = p.parseFloorDesc('5~9층');
      return f.kind === 'range' && f.min === 5 && f.max === 9;
    }
  },
  {
    id: 'C07',
    desc: '층구분: 콤마 리스트 "5,7,9"',
    run: function (p) {
      const f = p.parseFloorDesc('5,7,9');
      return f.kind === 'list' && f.floors.join(',') === '5,7,9';
    }
  },
  {
    id: 'C08',
    desc: '층구분: "20층이상"',
    run: function (p) {
      const f = p.parseFloorDesc('20층이상');
      return f.kind === 'above' && f.min === 20 && f.max === Infinity;
    }
  },
  {
    id: 'C09',
    desc: '층구분: "5층이하"',
    run: function (p) {
      const f = p.parseFloorDesc('5층이하');
      return f.kind === 'below' && f.min === 1 && f.max === 5;
    }
  },
  {
    id: 'C10',
    desc: '층구분: "저층(3~5층)" 라벨 포함',
    run: function (p) {
      const f = p.parseFloorDesc('저층(3~5층)');
      return f.kind === 'range' && f.label === '저층' && f.min === 3 && f.max === 5;
    }
  },
  {
    id: 'C11',
    desc: '다수 행(10개) 대형 테이블 처리',
    run: function (p) {
      const codes = [];
      const rows = [];
      for (let i = 1; i <= 10; i++) {
        const code = `08${i}A`;
        codes.push(code);
        rows.push(`${code}  ${i}층  10  5,000,000  ${300000000 + i}`);
      }
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n' + rows.join('\n'), codes);
      return price.priceRows.length === 10;
    }
  },
  {
    id: 'C12',
    desc: '섹션별 단위 혼용: 가격=원, 발코니=천원',
    run: function (p) {
      const codes = ['084A'];
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  5층  10  5,000,000  300,000,000', codes);
      const balcony = p.parseBalconySection('발코니 확장비 (단위: 천원)\n084A   14,500', codes);
      return price.unit_mult === 1 && balcony['084A'] === 14500000;
    }
  },
  {
    id: 'C13',
    desc: '동/라인 정보가 추가 컬럼으로 존재해도 파싱 유지',
    run: function (p) {
      const codes = ['084A'];
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  101동  5층  10  5,000,000  300,000,000', codes);
      return price.priceRows.length === 1 && price.priceRows[0].price === 300000000;
    }
  },
  {
    id: 'C14',
    desc: '합계 오프셋 2 (부가세 없음) 다수 행에서 일관되게 적용',
    run: function (p) {
      const codes = ['084A', '084B'];
      const price = p.parsePriceSection([
        '공급금액 및 납부일정 (단위: 원)  대지비 건축비 합계',
        '084A  5층  10  5,000,000  300,000,000',
        '084B  7층  10  5,000,000  310,000,000'
      ].join('\n'), codes);
      return price.priceRows.length === 2 && price.unit_mult === 1;
    }
  },
  {
    id: 'C15',
    desc: '합계 오프셋 3 (부가세 포함) 헤더 감지',
    run: function (p) {
      const hdr = p.parseTableHeader('공급금액 및 납부일정 (단위: 원)  대지비 건축비 부가가치세 합계');
      return hdr.offset === 3;
    }
  },
  {
    id: 'C16',
    desc: '계약금 비율(소수점 %) 지원, 예: 4.5%',
    run: function (p) {
      const codes = ['084A'];
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  5층  10  계약금 4.5%  300,000,000', codes);
      const r = price.priceRows[0];
      return r.down_is_ratio && Math.abs(r.down_ratio - 0.045) < 1e-9;
    }
  },
  {
    id: 'C17',
    desc: '불규칙 공백/빈 줄이 섞인 입력도 처리',
    run: function (p) {
      const codes = ['084A'];
      const text = '\n\n공급금액 및 납부일정 (단위: 원)\n\n   084A     5층    10    5,000,000    300,000,000   \n\n';
      const price = p.parsePriceSection(text, codes);
      return price.priceRows.length === 1 && price.priceRows[0].price === 300000000;
    }
  },
  {
    id: 'C18',
    desc: '탭(\\t) 구분자 입력 처리',
    run: function (p) {
      const codes = ['084A'];
      const text = '공급금액 및 납부일정 (단위: 원)\n084A\t5층\t10\t5,000,000\t300,000,000';
      const price = p.parsePriceSection(text, codes);
      return price.priceRows.length === 1 && price.priceRows[0].units === 10;
    }
  },
  {
    id: 'C19',
    desc: '단일 행 최소 테이블',
    run: function (p) {
      const area = p.parseAreaSection('084A  84.97  109.54  10');
      return area.length === 1 && area[0].supply_units === 10;
    }
  },
  {
    id: 'C20',
    desc: '세대수 0인 행도 결측 처리하지 않고 그대로 반영',
    run: function (p) {
      const codes = ['084A'];
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 원)\n084A  5층  0  5,000,000  300,000,000', codes);
      return price.priceRows.length === 1 && price.priceRows[0].units === 0;
    }
  },
  {
    id: 'C21',
    desc: '순수 숫자 코드(문자/점 없음, 예: 105타입)가 공급면적 섹션에서 인식',
    run: function (p) {
      const area = p.parseAreaSection('공급면적 및 공급규모\n105    84.97    109.54    92');
      return area.length === 1 && area[0].code === '105' && area[0].supply_units === 92;
    }
  },
  {
    id: 'C22',
    desc: 'midDates: 중도금 1~6차 날짜 추출',
    run: function (p) {
      const text = [
        '공급금액 및 납부일정 (단위: 원)',
        '중도금1차(2024.04.10) 중도금2차(2024.06.10) 중도금3차(2024.08.10)',
        '중도금4차(2024.10.10) 중도금5차(2024.12.10) 중도금6차(2025.02.10)',
        '084A  5층  10  5,000,000  300,000,000'
      ].join('\n');
      const price = p.parsePriceSection(text, ['084A']);
      return price.midDates.length === 6 && price.midDates[0] && price.midDates[0].getMonth() === 3 && price.midDates[5].getFullYear() === 2025;
    }
  },
  {
    id: 'C23',
    desc: '발코니/옵션 섹션에 해당 코드가 없으면 결과에 포함되지 않음',
    run: function (p) {
      const balcony = p.parseBalconySection('084A   14,500,000', ['999Z']);
      return Object.keys(balcony).length === 0;
    }
  },
  {
    id: 'C24',
    desc: '옵션가 섹션: 여러 코드 동시 처리',
    run: function (p) {
      const option = p.parseOptionSection('084A  3,200,000\n084B  3,500,000', ['084A', '084B']);
      return option['084A'] === 3200000 && option['084B'] === 3500000;
    }
  },
  {
    id: 'C25',
    desc: '메타: "-" 구분자 날짜 형식',
    run: function (p) {
      const meta = p.extractMeta('공고일: 2024-03-10');
      return meta.open_date.getFullYear() === 2024 && meta.open_date.getMonth() === 2 && meta.open_date.getDate() === 10;
    }
  },
  {
    id: 'C26',
    desc: '메타: 입주예정 표현이 문서 뒷부분에 있어도 추출',
    run: function (p) {
      const meta = p.extractMeta('여러 줄의 안내 문구...\n\n입주 예정 시기: 2027년 11월\n');
      return meta.move_in_year === 2027 && meta.move_in_month === 11;
    }
  },
  {
    id: 'C27',
    desc: '가격 없는 섹션(빈 문자열) 입력 시 빈 배열/객체 반환',
    run: function (p) {
      const price = p.parsePriceSection('', []);
      const balcony = p.parseBalconySection('', []);
      return price.priceRows.length === 0 && Object.keys(balcony).length === 0;
    }
  },
  {
    id: 'C28',
    desc: '공급면적 섹션에서 헤더 라인은 데이터로 오인되지 않음',
    run: function (p) {
      const area = p.parseAreaSection('공급면적 및 공급규모\n관리번호 주택형 전용면적(㎡) 공급면적(㎡) 공급세대수\n084A  84.97  109.54  10');
      return area.length === 1;
    }
  },
  {
    id: 'C29',
    desc: '천원 단위 가격 섹션에서 총액이 올바르게 원단위로 환산',
    run: function (p) {
      const price = p.parsePriceSection('공급금액 및 납부일정 (단위: 천원)\n084A  5층  10  5,000  300,000', ['084A']);
      return price.priceRows[0].price === 300000000;
    }
  },
  {
    id: 'C30',
    desc: '동일 코드가 여러 층구분으로 반복되는 다층 가격표',
    run: function (p) {
      const codes = ['084A'];
      const text = [
        '공급금액 및 납부일정 (단위: 원)',
        '084A  1~4층  8  5,000,000  295,000,000',
        '084A  5~9층  10  5,000,000  300,000,000',
        '084A  20층이상  4  5,000,000  310,000,000'
      ].join('\n');
      const price = p.parsePriceSection(text, codes);
      return price.priceRows.length === 3 &&
        price.priceRows[2].floor.kind === 'above' &&
        price.priceRows[2].price === 310000000;
    }
  }
];
