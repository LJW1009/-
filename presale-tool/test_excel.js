const XLSX = require('xlsx');
const { buildBlock, ref } = require('./excel.js');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK: ' + msg);
}

const unit = {
  name: '테스트단지', r1: '경기', r2: '수원시', kind: '아파트',
  interest: '유이자', rate: 4.8,
  open_date: '2024.03.10', open_dt: new Date(2024, 2, 10),
  move_in: '2026.05', move_in_dt: new Date(2026, 4, 30),
  mid_dates: [
    new Date(2024, 5, 10), new Date(2024, 8, 10), new Date(2024, 11, 10),
    new Date(2025, 2, 10), new Date(2025, 5, 10), new Date(2025, 8, 10)
  ],
  types: [
    {
      code: '084A', exclusive_area: 84.97, supply_area: 109.54,
      supply_units: 20, balcony_ext_cost: 14500000, option_cost: 3200000,
      rows: [
        { dong: '101동', floor: '1~4층', units: 8, price: 550000000 },
        { dong: '101동', floor: '5~9층', units: 12, price: 560000000 }
      ]
    },
    {
      code: '059B', exclusive_area: 59.97, supply_area: 78.12,
      supply_units: 10, balcony_ext_cost: 9800000, option_cost: 2100000,
      rows: [
        { dong: '102동', floor: '전체', units: 10, price: 420000000 }
      ]
    }
  ]
};

const ws = {};
const merges = [];
const rh = [];
const nextRow = buildBlock(ws, merges, rh, unit, 0);

console.log('nextRow =', nextRow);
console.log('merges =', JSON.stringify(merges));

// 기본 구조 검증
assert(ws['A1'].v.includes('테스트단지'), '헤더 타이틀에 단지명 포함');
assert(ws['A2'].v === '전용면적', '컬럼헤더 A2 = 전용면적');
assert(ws['I2'].v === '분양가', '컬럼헤더 I2 = 분양가');

// 데이터 행: row index 2 (0-based) = 첫 데이터행 (Excel row 3)
assert(ws['I3'].v === 550000000, '첫 데이터행 분양가 확인');
assert(Math.abs(ws['C3'].v - 109.54 * 0.3025) < 1e-6, '공급평수 계산 확인');
assert(ws['J3'].f === 'I3/C3', '평당가 수식 확인');
assert(ws['L3'].v === 550000000 + 14500000, '확장포함분양가 값 확인');

// 중도금 이자: 1차 (2024.06.10 -> 입주 2026.05.30, days 계산)
const days1 = Math.round((new Date(2026, 4, 30) - new Date(2024, 5, 10)) / 86400000);
const expectedInterest1 = 550000000 * 0.1 * 0.048 * days1 / 365;
assert(Math.abs(ws[ref(2, 56)].v - expectedInterest1) < 1, '1차 중도금 이자 계산 확인 (' + ws[ref(2,56)].v + ' vs ' + expectedInterest1 + ')');

// 소계행 존재 확인 (타입1은 2개 행 -> 소계 있음)
assert(ws['F5'] && ws['F5'].v === '소계', '타입1 소계행 존재');

// 합계행 존재 확인 (타입 2개 이상)
const totalRowRef = 'F' + (nextRow - 1); // row 이후 blank 한 줄을 빼면 합계행
console.log('합계행 후보:', totalRowRef, ws[totalRowRef]);

// 실제 엑셀 파일로 저장 후 재로드하여 구조 이상 없는지 확인
ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: nextRow, c: 63 } });
ws['!merges'] = merges;
const wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: ws } };
XLSX.writeFile(wb, '/tmp/test_output.xlsx');
const reloaded = XLSX.readFile('/tmp/test_output.xlsx');
assert(!!reloaded.Sheets['Sheet1'], '엑셀 파일 저장/재로드 성공');

console.log('\n모든 엑셀 빌더 검증 통과');
