/*
 * 실제 공고문 원문 회귀 테스트 (V01~V04) - 힐스테이트 송파더그리드 오피스텔의
 * "■ 중도금 대출 안내" 섹션. 타입 구간별로 중도금 무이자/이자후불제 조건이 다른
 * 문서를 parseInterestSection이 정확히 코드별로 분리해내는지 검증한다.
 */
var INTEREST_TEXT = [
  '■ 중도금 대출 안내',
  '• 본 오피스텔의 중도금 대출 시 대출 관련 대출기관과 세부 내용은 추후 별도 공지될 예정입니다.',
  '• 대출기관 : 추후 별도 공지 예정, 중도금 대출기관은 분양사업자가 선정하며, 대출조건(금리 등) 및 금융기관 선정 등과 관련하여 계약자는 관여할 수 없으니 이를 명확히 인지한 후 계약하시기 바랍니다.',
  '• 대출금액 : 본 오피스텔 중도금 대출 시 34A㎡, 34B㎡, 36㎡ 타입은 "중도금 무이자 대출", 42㎡~119㎡ 타입은 "중도금 대출 이자 후불제"조건으로 총 분양(공급)대금의 50% 범위 내에서 사업주체가 지정하는 대출취급기관에서 융자 알선을 시행할 예정입니다. (중도금1회차 ~ 5회차)'
].join('\n');

var CODES = ['34A', '34B', '36', '42A', '42B1', '42B2', '42C1', '42C2', '48', '50A', '50B', '50C', '52',
  '111', '115', '118', '119'];

module.exports = [
  {
    id: 'V01',
    desc: '실사례 중도금 대출 안내: 목록형("34A㎡, 34B㎡, 36㎡ 타입은")이 무이자로 정확히 인식됨',
    run: function (p) {
      var m = p.parseInterestSection(INTEREST_TEXT, CODES);
      return m['34A'] === '무이자' && m['34B'] === '무이자' && m['36'] === '무이자';
    }
  },
  {
    id: 'V02',
    desc: '실사례 중도금 대출 안내: 범위형("42㎡~119㎡ 타입은")이 이자후불제로 정확히 인식되고, 범위 밖 코드는 포함되지 않음',
    run: function (p) {
      var m = p.parseInterestSection(INTEREST_TEXT, CODES);
      return m['42A'] === '후불제' && m['48'] === '후불제' && m['119'] === '후불제'
        && m['34A'] !== '후불제'; // 무이자 그룹과 겹치지 않음
    }
  },
  {
    id: 'V03',
    desc: '실사례 중도금 대출 안내: 범위/목록에 언급된 모든 코드가 빠짐없이 커버됨(17개)',
    run: function (p) {
      var m = p.parseInterestSection(INTEREST_TEXT, CODES);
      return Object.keys(m).length === CODES.length;
    }
  },
  {
    id: 'V04',
    desc: '"■ 중도금 대출 안내" 섹션 자체가 없는 문서는 빈 객체를 반환(회귀 없음 - 단지 전체 설정을 그대로 씀)',
    run: function (p) {
      var m = p.parseInterestSection('■ 공급대상 및 공급규모\n34A 156 34.9930 ...', CODES);
      return Object.keys(m).length === 0;
    }
  }
];

module.exports.TEXT = { INTEREST_TEXT: INTEREST_TEXT, CODES: CODES };
