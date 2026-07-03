/*
 * 분양가 정리 도구 - 파서 모듈 (Agent A)
 *
 * Contract:
 *   parseAreaSection(text)              -> [{code, exclusive_area, supply_area, supply_units}]
 *   parsePriceSection(text, codes)       -> {midDates, priceRows, unit_mult}
 *   parseBalconySection(text, codes)     -> {code: amount}
 *   parseOptionSection(text, codes)      -> {code: amount}
 *   extractMeta(text)                    -> {open_date, move_in_year, move_in_month}
 *
 * 원칙: 앵커(고정 위치) 기반 파싱 대신 헤더를 먼저 읽어 단위/오프셋을 결정한 뒤 데이터 행을 해석한다.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // 공통 유틸
  // ---------------------------------------------------------------------

  function lines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (l) { return l.replace(/ /g, ' ').trim(); })
      .filter(function (l) { return l.length > 0; });
  }

  // 숫자 토큰(콤마/공백 포함) -> Number. 실패 시 NaN
  function toNum(tok) {
    if (tok == null) return NaN;
    var s = String(tok).replace(/[,\s원]/g, '');
    if (s === '' || s === '-') return NaN;
    return Number(s);
  }

  function isNum(tok) {
    return /^-?\d[\d,]*(\.\d+)?$/.test(String(tok).trim());
  }

  // 주택형/관리번호 코드로 볼 수 있는 토큰인가
  // 예: 084.9750A, 059.9700, 101A, T101A, 84A
  function isCodeToken(tok) {
    return /^[A-Za-z]?\d{2,3}(\.\d+)?[A-Za-z]{0,2}$/.test(tok) && /[A-Za-z]|\./.test(tok) === true || /^[A-Za-z]\d+[A-Za-z]?$/.test(tok);
  }

  function splitCols(line) {
    return line.split(/\t+|\s{2,}|\s(?=\d)|(?<=\D)\s(?=[A-Za-z0-9])/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  // 좀더 단순하고 견고한 토크나이저: 탭/2칸 이상 공백을 컬럼 구분자로, 그 외 단일 공백은 유지
  function tokenize(line) {
    // 우선 탭 또는 2칸 이상 공백으로 분리 시도
    var byWide = line.split(/\t+|\s{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (byWide.length > 1) return byWide;
    // 단일 공백만 있는 경우 전체를 공백 단위로 분리
    return line.split(/\s+/).filter(Boolean);
  }

  // ---------------------------------------------------------------------
  // 헤더 분석 (단위 / 합계 오프셋)
  // ---------------------------------------------------------------------

  function detectUnitMult(headerText) {
    if (/천\s*원/.test(headerText)) return 1000;
    return 1;
  }

  // 대지비 건축비 (부가세) 합계 오프셋: "합계"가 대지비/건축비/부가세 클러스터 뒤에 몇 칸 떨어져 있는지
  function detectOffset(headerText) {
    var hasVat = /부가가치세|부가세/.test(headerText);
    return hasVat ? 3 : 2;
  }

  function parseTableHeader(sectionText) {
    var ls = lines(sectionText);
    var headerLines = ls.slice(0, 4).join(' ');
    var unit_mult = detectUnitMult(headerText(sectionText));
    var offset = detectOffset(headerLines);
    var midDates = extractMidDates(sectionText);
    return { unit_mult: unit_mult, offset: offset, midDates: midDates };
  }

  function headerText(text) {
    // 괄호 안 단위표기, 혹은 상단 3줄
    var m = String(text).match(/\(\s*단위\s*[:：]?\s*[^\)]*\)/);
    if (m) return m[0];
    return lines(text).slice(0, 3).join(' ');
  }

  function extractMidDates(text) {
    // 중도금 1~6차 옆의 날짜 (YYYY.MM.DD / YYYY-MM-DD / YYYY년 MM월 DD일)
    var dates = [];
    var re = /중도금\s*(\d)\s*차[^0-9]{0,10}(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})/g;
    var m;
    var byIdx = {};
    while ((m = re.exec(text))) {
      var idx = Number(m[1]);
      byIdx[idx] = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]));
    }
    for (var i = 1; i <= 6; i++) dates.push(byIdx[i] || null);
    return dates;
  }

  // ---------------------------------------------------------------------
  // ① 공급면적 및 공급규모
  // ---------------------------------------------------------------------

  function parseAreaSection(text) {
    var out = [];
    var ls = lines(text);
    for (var i = 0; i < ls.length; i++) {
      var line = ls[i];
      if (/공급면적|공급규모|전용면적|관리번호|주택형|호형/.test(line) && !/\d\.\d/.test(line)) {
        continue; // 헤더성 라인 스킵 (숫자 데이터가 없는 라벨 라인)
      }
      var toks = tokenize(line);
      if (toks.length < 3) continue;

      // 숫자 토큰들 수집 (콤마 포함 정수/소수)
      var nums = [];
      var numIdx = [];
      for (var j = 0; j < toks.length; j++) {
        if (isNum(toks[j])) { nums.push(toNum(toks[j])); numIdx.push(j); }
      }
      // 면적(소수) 두 개 + 세대수(정수) 한 개 이상 필요
      var floats = [];
      var ints = [];
      for (var k = 0; k < toks.length; k++) {
        if (/^\d+\.\d+$/.test(toks[k])) floats.push({ v: Number(toks[k]), idx: k });
        else if (/^\d+$/.test(toks[k])) ints.push({ v: Number(toks[k]), idx: k });
      }
      if (floats.length < 2) continue;

      // 전용면적 < 공급면적 이라는 도메인 지식으로 정렬
      floats.sort(function (a, b) { return a.v - b.v; });
      var exclusive_area = floats[0].v;
      var supply_area = floats[floats.length - 1].v;

      // 세대수: 정수 토큰 중 마지막 것 (관리번호 등 코드성 정수는 이미 floats/ints 분류에서 실수와 섞이지 않음을 전제)
      var supply_units = ints.length ? ints[ints.length - 1].v : NaN;
      if (!isFinite(supply_units)) continue;

      // 코드: 숫자+영문 조합 토큰 중 첫 번째, 혹은 면적 소수값에서 유도 (059.9700A 등)
      var code = null;
      for (var t = 0; t < toks.length; t++) {
        if (/^[A-Za-z]?\d{2,3}(\.\d+)?[A-Za-z]{0,2}$/.test(toks[t]) && /[A-Za-z]/.test(toks[t])) {
          code = toks[t];
          break;
        }
      }
      if (!code) {
        // 순수 숫자 코드도 허용 (예: 084.9750)
        for (var t2 = 0; t2 < toks.length; t2++) {
          if (/^\d{2,3}\.\d{2,4}$/.test(toks[t2])) { code = toks[t2]; break; }
        }
      }
      if (!code) continue;

      out.push({
        code: code,
        exclusive_area: exclusive_area,
        supply_area: supply_area,
        supply_units: supply_units
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // 층구분 파싱 (FL)
  // ---------------------------------------------------------------------

  function parseFloorDesc(raw) {
    var s = String(raw || '').trim();
    var label = '';
    var lm = s.match(/^([가-힣]+)\s*\(([^)]+)\)$/);
    if (lm) { label = lm[1]; s = lm[2]; }

    s = s.replace(/층/g, '').trim();

    var m;
    if ((m = s.match(/^(\d+)\s*이상$/))) {
      return { raw: raw, kind: 'above', min: Number(m[1]), max: Infinity, label: label };
    }
    if ((m = s.match(/^(\d+)\s*이하$/))) {
      return { raw: raw, kind: 'below', min: 1, max: Number(m[1]), label: label };
    }
    if ((m = s.match(/^(\d+)\s*[~\-]\s*(\d+)$/))) {
      return { raw: raw, kind: 'range', min: Number(m[1]), max: Number(m[2]), label: label };
    }
    if (/^\d+(\s*,\s*\d+)+$/.test(s)) {
      var floors = s.split(',').map(function (x) { return Number(x.trim()); });
      return { raw: raw, kind: 'list', floors: floors, min: Math.min.apply(null, floors), max: Math.max.apply(null, floors), label: label };
    }
    if ((m = s.match(/^(\d+)$/))) {
      return { raw: raw, kind: 'exact', min: Number(m[1]), max: Number(m[1]), label: label };
    }
    // 인식 불가 -> 전체(all)로 취급
    return { raw: raw, kind: 'all', min: null, max: null, label: label };
  }

  // ---------------------------------------------------------------------
  // ② 공급금액 및 납부일정
  // ---------------------------------------------------------------------

  function parsePriceSection(text, codes) {
    var hdr = parseTableHeader(text);
    var unit_mult = hdr.unit_mult;
    var offset = hdr.offset;
    var midDates = hdr.midDates;

    var codeSet = codes && codes.length ? codes.slice() : null;
    var priceRows = [];
    var ls = lines(text);

    for (var i = 0; i < ls.length; i++) {
      var line = ls[i];
      if (/^\(?\s*단위/.test(line)) continue;
      if (/구분|계약금|중도금|잔금|대지비|건축비|합계|공급금액|납부일정/.test(line) && !/\d/.test(line.replace(/[0-9]/g, ''))) {
        // 라벨/숫자 혼재 판단이 애매하므로 아래 별도 검사로 대체
      }

      var toks = tokenize(line);
      if (toks.length < 2) continue;

      // 코드 탐색: codes가 주어지면 정확히 일치하는 토큰을 우선 사용 (임의의 코드 형식 지원)
      var code = null;
      if (codeSet) {
        for (var tc = 0; tc < toks.length; tc++) {
          if (codeSet.indexOf(toks[tc]) !== -1) { code = toks[tc]; break; }
        }
      }
      if (!code) {
        for (var t = 0; t < toks.length; t++) {
          if (/^[A-Za-z]?\d{2,3}(\.\d+)?[A-Za-z]{0,2}$/.test(toks[t]) && /[A-Za-z]/.test(toks[t])) { code = toks[t]; break; }
        }
        if (!code) {
          for (var t3 = 0; t3 < toks.length; t3++) {
            if (/^\d{2,3}\.\d{2,4}$/.test(toks[t3])) { code = toks[t3]; break; }
          }
        }
      }
      if (!code) continue;
      if (codeSet && codeSet.indexOf(code) === -1) continue;

      // 층구분 탐색: '층' 포함 토큰이거나 숫자/범위 패턴, 또는 이상/이하 포함, 콤마 리스트
      var floorTok = null;
      for (var f = 0; f < toks.length; f++) {
        var tk = toks[f];
        if (tk === code) continue;
        if (/층|이상|이하/.test(tk) || /^\d+([~\-,]\d+)*$/.test(tk)) {
          floorTok = tk;
          break;
        }
      }
      floorTok = floorTok || '전체';
      var floor = parseFloorDesc(floorTok);

      // 동/라인 탐색: "101동", "A라인" 등
      var dong = '';
      for (var d = 0; d < toks.length; d++) {
        if (/^\d+동$/.test(toks[d]) || /라인$/.test(toks[d])) { dong = toks[d]; break; }
      }

      // 금액 계열 숫자 수집 (큰 정수형, 콤마 포함 가능)
      var moneyToks = toks.filter(function (tk) {
        return /^\d[\d,]*$/.test(tk) && tk.length >= 4;
      }).map(toNum);

      if (!moneyToks.length) continue;

      // 세대수: 가장 작은 숫자(2~4자리)로 간주되는 순수 정수, 금액과 겹치지 않도록 3자리 미만 우선
      var unitsTok = toks.filter(function (tk) { return /^\d{1,3}$/.test(tk); });
      var units = unitsTok.length ? Number(unitsTok[0]) : null;

      // 합계 = 마지막에서 (offset-1)번째... 실무적으로 금액열의 "합계"는 보통 맨 뒤에서 두번째~세번째
      // 단순화: 계약금+중도금(6)+잔금 이후 나오는 합계열을 오프셋으로 식별
      // 데이터 부족 시 marker: 전체 금액 토큰 중 최댓값을 총액(price)으로 사용
      var price = Math.max.apply(null, moneyToks) * unit_mult;

      // 계약금: 금액 토큰 중 가장 작은 값 (정액), 혹은 %) 패턴이면 비율
      var downRatioMatch = line.match(/계약금[^%\d]{0,20}(\d{1,2}(?:\.\d+)?)\s*%/);
      var down_is_ratio = !!downRatioMatch;
      var down_ratio = downRatioMatch ? Number(downRatioMatch[1]) / 100 : null;
      var down_payment = down_is_ratio ? null : (moneyToks.length ? Math.min.apply(null, moneyToks) * unit_mult : null);

      priceRows.push({
        code: code,
        floor: floor,
        dong: dong,
        units: units,
        price: price,
        down_payment: down_payment,
        down_is_ratio: down_is_ratio,
        down_ratio: down_ratio
      });
    }

    return { midDates: midDates, priceRows: priceRows, unit_mult: unit_mult };
  }

  // ---------------------------------------------------------------------
  // ③ 발코니 확장비 / ④ 옵션(에어컨)
  // ---------------------------------------------------------------------

  function parseAmountByCodeSection(text, codes) {
    var unit_mult = detectUnitMult(headerText(text));
    var codeSet = codes && codes.length ? codes.slice() : null;
    var result = {};
    var ls = lines(text);
    for (var i = 0; i < ls.length; i++) {
      var toks = tokenize(ls[i]);
      var code = null;
      if (codeSet) {
        for (var tc = 0; tc < toks.length; tc++) {
          if (codeSet.indexOf(toks[tc]) !== -1) { code = toks[tc]; break; }
        }
      }
      if (!code) {
        for (var t = 0; t < toks.length; t++) {
          if (/^[A-Za-z]?\d{2,3}(\.\d+)?[A-Za-z]{0,2}$/.test(toks[t]) && /[A-Za-z]/.test(toks[t])) { code = toks[t]; break; }
        }
        if (!code) {
          for (var t3 = 0; t3 < toks.length; t3++) {
            if (/^\d{2,3}\.\d{2,4}$/.test(toks[t3])) { code = toks[t3]; break; }
          }
        }
      }
      if (!code) continue;
      if (codeSet && codeSet.indexOf(code) === -1) continue;
      var moneyToks = toks.filter(function (tk) { return /^\d[\d,]*$/.test(tk) && tk.length >= 4; }).map(toNum);
      if (!moneyToks.length) { result[code] = 0; continue; }
      result[code] = Math.max.apply(null, moneyToks) * unit_mult;
    }
    return result;
  }

  function parseBalconySection(text, codes) {
    return parseAmountByCodeSection(text, codes);
  }

  function parseOptionSection(text, codes) {
    return parseAmountByCodeSection(text, codes);
  }

  // ---------------------------------------------------------------------
  // ⑤ 메타 정보
  // ---------------------------------------------------------------------

  function parseKDate(str) {
    var m = str.match(/(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})?/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
  }

  function extractMeta(text) {
    var open_date = null;
    var move_in_year = null;
    var move_in_month = null;

    var openM = text.match(/(?:입주자\s*모집\s*)?공고일\s*[:：]?\s*(\d{4}[.\-년]\s*\d{1,2}[.\-월]\s*\d{1,2}[일]?)/);
    if (openM) open_date = parseKDate(openM[1]);

    var moveM = text.match(/입주\s*예정\s*(?:월|일|시기)?\s*[:：]?\s*(\d{4})\s*[년.\-]\s*(\d{1,2})\s*월?/);
    if (moveM) {
      move_in_year = Number(moveM[1]);
      move_in_month = Number(moveM[2]);
    }

    return { open_date: open_date, move_in_year: move_in_year, move_in_month: move_in_month };
  }

  // ---------------------------------------------------------------------
  // export
  // ---------------------------------------------------------------------

  var api = {
    parseAreaSection: parseAreaSection,
    parsePriceSection: parsePriceSection,
    parseBalconySection: parseBalconySection,
    parseOptionSection: parseOptionSection,
    extractMeta: extractMeta,
    // 디버그/QA용 내부 함수 노출
    parseTableHeader: parseTableHeader,
    parseFloorDesc: parseFloorDesc,
    detectUnitMult: detectUnitMult,
    detectOffset: detectOffset,
    extractMidDates: extractMidDates
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  for (var k in api) { root[k] = api[k]; }
})(typeof window !== 'undefined' ? window : globalThis);
