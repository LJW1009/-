/*
 * 분양가 정리 도구 - 파서 모듈 (Agent A)
 *
 * Contract:
 *   parseAreaSection(text)                      -> [{code, exclusive_area, supply_area, supply_units}]
 *   parsePriceSection(text, codes, baseDate?)    -> {midDates, priceRows, unit_mult}
 *   parseBalconySection(text, codes)             -> {code: amount}
 *   parseOptionSection(text, codes)              -> {code: amount}
 *   extractMeta(text)                            -> {open_date, move_in_year, move_in_month}
 *
 * (baseDate는 하위호환 3번째 선택 인자: 상대일자 "30일이내" 등을 절대일자로 환산할 때 기준일로 사용)
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
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
  }

  // 표 헤더 키워드가 PDF 복사 과정에서 공백 없이 붙는 오염("잔금대지비") 교정
  var KEYWORDS = ['계약금', '중도금', '잔금', '대지비', '건축비', '부가가치세', '부가세', '합계', '소계', '공급금액', '납부일정'];
  var KEYWORD_ALT = KEYWORDS.join('|');
  var GLUE_RE = new RegExp('(' + KEYWORD_ALT + ')(?=(' + KEYWORD_ALT + '))', 'g');
  function despaceKeywords(text) {
    return String(text || '').replace(GLUE_RE, '$1 ');
  }

  // 숫자 토큰(콤마/공백/단위기호 포함) -> Number. 실패 시 NaN
  function toNum(tok) {
    if (tok == null) return NaN;
    var s = String(tok).replace(/[,\s원㎡]/g, '');
    if (s === '' || s === '-') return NaN;
    return Number(s);
  }

  function isNum(tok) {
    return /^-?\d[\d,]*(\.\d+)?$/.test(String(tok).trim());
  }

  // 짧은형 코드: 84A, 54A1, 84OA, 200A, 84O, 84E1-T(하이픈 접미사) 등 (점(.) 없는 숫자+영문 조합)
  var SHORT_CODE_RE = /^\d{2,4}[A-Za-z]{1,3}\d{0,2}(?:-[A-Za-z]{1,3})?$/;
  // 긴 소수형 코드: 059.9700A (문자 접미사 필수 - 없으면 순수 면적값과 구분 불가)
  var LONG_CODE_RE = /^\d{2,3}\.\d{2,4}[A-Za-z]{1,2}$/;

  // 좀더 단순하고 견고한 토크나이저: 탭/2칸 이상 공백을 컬럼 구분자로, 그 외 단일 공백은 유지
  function tokenize(line) {
    var byWide = line.split(/\t+|\s{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (byWide.length > 1) return byWide;
    return line.split(/\s+/).filter(Boolean);
  }

  // 알려진 codes 목록을 이용해 한 줄 안에서 코드(들)를 찾는다.
  // 쉼표/공백/슬래시/가운뎃점으로 나뉜 조각을 개별 비교하고, 인접 조각을 합친 것도 비교한다.
  // (예: "76, 84A, 84B" 묶음형, "84 A" 처럼 코드 내부에 공백이 낀 경우 모두 지원)
  function findCodesInLine(line, codeSet) {
    if (!codeSet || !codeSet.length) return { codes: [], consumed: [] };
    var parts = line.split(/[,，·/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var found = [];
    var consumed = [];
    parts.forEach(function (p) {
      if (codeSet.indexOf(p) !== -1 && found.indexOf(p) === -1) { found.push(p); consumed.push(p); }
    });
    for (var i = 0; i < parts.length - 1; i++) {
      var merged = parts[i] + parts[i + 1];
      if (codeSet.indexOf(merged) !== -1 && found.indexOf(merged) === -1) {
        found.push(merged); consumed.push(parts[i]); consumed.push(parts[i + 1]);
      }
    }
    return { codes: found, consumed: consumed };
  }

  // PDF 복사 시 표 전체가 개행 없이 한 줄로 직렬화되는 경우, 알려진 codes 위치를 앵커로 행을 분리
  function expandMegaLines(ls, codeSet) {
    if (!codeSet || !codeSet.length) return ls;
    var out = [];
    ls.forEach(function (line) {
      var matches = [];
      codeSet.forEach(function (c) {
        var idx = -1;
        while ((idx = line.indexOf(c, idx + 1)) !== -1) matches.push({ idx: idx, code: c });
      });
      if (matches.length <= 1) { out.push(line); return; }
      matches.sort(function (a, b) { return a.idx - b.idx || b.code.length - a.code.length; });
      var dedup = [];
      matches.forEach(function (m) {
        var last = dedup[dedup.length - 1];
        if (last && m.idx < last.idx + last.code.length) return; // 겹치는 매치 제외
        dedup.push(m);
      });
      for (var i = 0; i < dedup.length; i++) {
        var start = dedup[i].idx;
        var end = (i + 1 < dedup.length) ? dedup[i + 1].idx : line.length;
        var seg = line.slice(start, end).trim();
        if (seg) out.push(seg);
      }
    });
    return out;
  }

  // 동/호 표기 추출: "101동 2호", "2·3호", "1호/4호", "101동 102동 1호, 4호" 등
  function extractDong(line) {
    var re = /[\d·,/]*\d\s*(?:동|호)/g;
    var matches = [];
    var m;
    while ((m = re.exec(line))) matches.push({ idx: m.index, end: m.index + m[0].length });
    if (!matches.length) return '';
    var start = matches[0].idx;
    var end = matches[matches.length - 1].end;
    return line.slice(start, end).replace(/·/g, ', ').replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------------
  // 날짜 (유연한 형식 + 상대일자)
  // ---------------------------------------------------------------------

  // 2~4자리 연도, 구분자 . - / 년, 말미 마침표 허용: 2026.10.06 / 24.09.25 / 2026-07-28 / 2026/10/06 / 2026.10.15.
  function parseFlexDate(str) {
    var m = String(str || '').match(/(\d{2,4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})\s*\.?\s*일?/);
    if (!m) return null;
    var y = Number(m[1]);
    if (y < 100) y += 2000;
    var d = new Date(y, Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  // "계약 후 30일이내", "계약30일내", "30일이내", "30일 이내", "계약후30일", "1달이내"
  function parseRelativeOffset(str) {
    var s = String(str || '');
    var m = s.match(/(\d+)\s*일\s*(?:이내|내)?/);
    if (m) return { days: Number(m[1]) };
    var m2 = s.match(/(\d+)\s*(?:달|개월)\s*(?:이내|내)?/);
    if (m2) return { months: Number(m2[1]) };
    return null;
  }

  function applyOffset(baseDate, off) {
    if (!baseDate || !off) return null;
    var d = new Date(baseDate.getTime());
    if (off.days) d.setDate(d.getDate() + off.days);
    if (off.months) d.setMonth(d.getMonth() + off.months);
    return d;
  }

  // ---------------------------------------------------------------------
  // 헤더 분석 (단위 / 합계 오프셋)
  // ---------------------------------------------------------------------

  function detectUnitMult(hdrText) {
    if (/천\s*원/.test(hdrText)) return 1000;
    return 1;
  }

  // 대지비 건축비 (부가세) 합계 오프셋: 부가세 표기 유무만으로 결정.
  // 합계열 라벨은 "합계"/"소계"/"계" 등으로 다양하게 표기되지만 오프셋 자체와는 무관하다.
  function detectOffset(hdrText) {
    var hasVat = /부가가치세|부가세/.test(hdrText);
    return hasVat ? 3 : 2;
  }

  function parseTableHeader(sectionText, baseDate) {
    var text = despaceKeywords(sectionText);
    var ls = lines(text);
    var headerLines = ls.slice(0, 4).join(' ');
    var unit_mult = detectUnitMult(headerText(text));
    var offset = detectOffset(headerLines);
    var midDates = extractMidDates(text, baseDate);
    return { unit_mult: unit_mult, offset: offset, midDates: midDates };
  }

  function headerText(text) {
    var m = String(text).match(/\(\s*단위\s*[:：]?\s*[^)]*\)/);
    if (m) return m[0];
    return lines(text).slice(0, 3).join(' ');
  }

  function extractMidDates(text, baseDate) {
    var dates = [];
    var byIdx = {};
    var re = /중도금\s*(\d)\s*차([^중]{0,40})/g;
    var m;
    while ((m = re.exec(text))) {
      var idx = Number(m[1]);
      var chunk = m[2];
      var d = parseFlexDate(chunk);
      if (!d && baseDate) d = applyOffset(baseDate, parseRelativeOffset(chunk));
      if (d) byIdx[idx] = d;
    }
    for (var i = 1; i <= 6; i++) dates.push(byIdx[i] || null);
    return dates;
  }

  // ---------------------------------------------------------------------
  // ① 공급면적 및 공급규모
  // ---------------------------------------------------------------------

  // 전용면적+공용면적=소계(공급면적) 같은 산술 관계를 면적값들 사이에서 직접 찾는다.
  // 계약면적=소계+기타공용처럼 여러 단계로 누적되는 경우가 있어도, 가장 작은 합계(가장 안쪽
  // 단계)를 우선해 정확한 전용/공급 쌍을 골라낸다. 코드가 면적을 반영하지 않는 임의 표기
  // (오피스텔 호실번호 등)에서도 코드 힌트 없이 동작하는 것이 핵심 이점이다.
  function findAreaTriple(floats) {
    var best = null;
    for (var i = 0; i < floats.length; i++) {
      for (var j = i + 1; j < floats.length; j++) {
        var sum = floats[i].v + floats[j].v;
        for (var k = 0; k < floats.length; k++) {
          if (k === i || k === j) continue;
          if (Math.abs(floats[k].v - sum) <= 0.02 && (!best || floats[k].v < best.c)) {
            best = { a: floats[i].v, b: floats[j].v, c: floats[k].v };
          }
        }
      }
    }
    return best;
  }

  // 한 주택형 분량의 토큰 조각에서 {code, exclusive_area, supply_area, supply_units}를 추출.
  // 세그먼트 경계가 느슨해 앞/뒤 다른 주택형의 꼬리 토큰이 약간 섞여 들어와도,
  // "면적값 이후 첫 정수 우선, 없으면 면적값 이전 마지막 정수"와 "코드 숫자 접두부에 가장
  // 가까운 면적값" 규칙 덕분에 실제 값이 안정적으로 골라진다.
  function extractAreaFromTokens(toks) {
    var floats = [];
    var ints = [];
    for (var k = 0; k < toks.length; k++) {
      if (/^\d+\.\d+$/.test(toks[k])) floats.push({ v: Number(toks[k]), idx: k });
      else if (/^\d+$/.test(toks[k])) ints.push({ v: Number(toks[k]), idx: k });
    }
    if (floats.length < 2) return null;

    // 코드: 1) 짧은형(84A 등) 2) 긴 소수형(084.9750A 등) 3) 면적값 바로 옆 순수정수(마지막 수단)
    var code = null;
    for (var t = 0; t < toks.length; t++) {
      if (SHORT_CODE_RE.test(toks[t])) { code = toks[t]; break; }
    }
    if (!code) {
      for (var t2 = 0; t2 < toks.length; t2++) {
        if (LONG_CODE_RE.test(toks[t2])) { code = toks[t2]; break; }
      }
    }
    var floatIdxs = floats.map(function (f) { return f.idx; });
    var firstFloatIdx = Math.min.apply(null, floatIdxs);
    var maxFloatIdx = Math.max.apply(null, floatIdxs);
    if (!code) {
      var adj = [toks[firstFloatIdx - 1], toks[firstFloatIdx + 1]].filter(Boolean);
      for (var ai = 0; ai < adj.length; ai++) {
        if (/^\d{2,3}$/.test(adj[ai]) && Number(adj[ai]) < 1000) { code = adj[ai]; break; }
      }
    }
    if (!code) return null;

    // 세대수: 면적값 뒤에 오는 정수 중 첫 번째(총공급세대수, 그 뒤로 특별공급 등 세부내역이 이어짐).
    // 면적값 뒤에 정수가 전혀 없으면(세대수가 코드 바로 앞에 오는 오피스텔 "코드+세대수 먼저"형)
    // 면적값 앞의 마지막 정수를 사용한다.
    var intsAfter = ints.filter(function (x) { return x.idx > maxFloatIdx && x.v < 1000; });
    var intsBefore = ints.filter(function (x) { return x.idx < firstFloatIdx && x.v < 1000; });
    var supply_units = intsAfter.length ? intsAfter[0].v : (intsBefore.length ? intsBefore[intsBefore.length - 1].v : NaN);
    if (!isFinite(supply_units)) return null;

    // 전용/공급면적: 1) 우선 "전용+공용=소계" 산술 관계를 면적값들 사이에서 직접 찾는다(코드가
    // 면적을 반영하지 않는 임의 코드에도 통함). 2) 못 찾으면 코드 숫자 접두부에 가장 가까운
    // 면적값을 전용면적으로, 그보다 큰 값 중 최솟값을 공급면적으로 삼는 방식으로 폴백한다.
    var exclusive_area, supply_area;
    var triple = floats.length >= 3 ? findAreaTriple(floats) : null;
    if (triple) {
      exclusive_area = Math.max(triple.a, triple.b);
      supply_area = triple.c;
    } else {
      var codeNum = parseFloat((code.match(/\d+/) || [])[0]);
      var byAsc = floats.slice().sort(function (a, b) { return a.v - b.v; });
      var byCloseness = floats.slice().sort(function (a, b) { return Math.abs(a.v - codeNum) - Math.abs(b.v - codeNum); });
      // codeNum이 실제 면적 접두부일 때만 근접도 기준을 신뢰한다. "101A" 같은 호실번호형 코드처럼
      // 면적과 무관한 숫자면 근접도가 무의미하므로 오름차순(최솟값) 기준으로 되돌아간다.
      var closestDiffRatio = isFinite(codeNum) && codeNum > 0 ? Math.abs(byCloseness[0].v - codeNum) / codeNum : Infinity;
      exclusive_area = (isFinite(codeNum) && closestDiffRatio <= 0.5) ? byCloseness[0].v : byAsc[0].v;
      var rest = floats.filter(function (f) { return f.v > exclusive_area; }).sort(function (a, b) { return a.v - b.v; });
      supply_area = rest.length ? rest[0].v : exclusive_area;
    }

    return { code: code, exclusive_area: exclusive_area, supply_area: supply_area, supply_units: supply_units };
  }

  function parseAreaSection(text) {
    text = fixGluedNumbers(String(text || '').replace(/㎡/g, ' '));
    var tokens = text.split(/\s+/).filter(Boolean);

    // 주택형 경계: 짧은형 코드(84A 등)를 우선 경계로 삼는다. 관리번호형 표는 "059.0000A"
    // 같은 긴 그룹코드 하나에 실제로는 서로 다른 여러 짧은형 하위타입(59AL/59A/59AH 등,
    // 각기 면적·세대수가 다름)이 딸려 있는 경우가 있어(1:1이 아님), 긴 코드를 경계로 삼으면
    // 하위타입들이 한 세그먼트로 뭉개진다. 짧은형이 전혀 없을 때만(예: "059.9700A"처럼
    // 약식표기 없이 긴 코드만 쓰는 표) 긴 소수형 코드를 경계로 쓴다.
    var boundaries = [];
    for (var i = 0; i < tokens.length; i++) if (SHORT_CODE_RE.test(tokens[i])) boundaries.push(i);
    if (!boundaries.length) {
      for (var i2 = 0; i2 < tokens.length; i2++) if (LONG_CODE_RE.test(tokens[i2])) boundaries.push(i2);
    }
    if (!boundaries.length) {
      // 짧은형/긴형 코드가 전혀 없는 경우(순수 숫자 코드형): 줄 단위로 폴백해
      // extractAreaFromTokens의 "면적값 인접 순수정수" 최후수단 규칙에 맡긴다.
      var out2 = [];
      lines(text).forEach(function (line) {
        if (/공급면적|공급규모|전용면적|관리번호|주택형|호형/.test(line) && !/\d\.\d/.test(line)) return;
        var lineToks = tokenize(line);
        if (lineToks.length < 3) return;
        var parsed2 = extractAreaFromTokens(lineToks);
        if (parsed2) out2.push(parsed2);
      });
      return out2;
    }

    // "합계/합 계/계" 총계행이 나오면 그 이전까지만 데이터로 취급 (마지막 주택형의 꼬리 오염 방지).
    // 바로 뒤에 "계" 한 글자만 오는 경우("계 24")는 마지막 경계 이후에 나올 때만 총계로 인정한다
    // (다른 문맥의 "계" 단어와 혼동하지 않도록).
    var lastBoundary = boundaries[boundaries.length - 1];
    var totalIdx = tokens.length;
    for (var ti = 0; ti < tokens.length; ti++) {
      var isTotalRow = /^합계$/.test(tokens[ti]) ||
        (/^합$/.test(tokens[ti]) && tokens[ti + 1] && /^계$/.test(tokens[ti + 1])) ||
        (/^계$/.test(tokens[ti]) && ti > lastBoundary && tokens[ti + 1] && /^\d+$/.test(tokens[ti + 1]));
      if (isTotalRow) { totalIdx = ti; break; }
    }

    var out = [];
    for (var b = 0; b < boundaries.length; b++) {
      // 1차 시도: 코드 자신부터 다음 경계 직전까지(이전 행 꼬리 오염 없음) - 대부분의 형식이 여기 해당.
      var segStart = boundaries[b];
      var segEnd = (b + 1 < boundaries.length) ? boundaries[b + 1] : totalIdx;
      if (segEnd <= segStart) continue;
      var parsed = extractAreaFromTokens(tokens.slice(segStart, segEnd));
      // 2차 시도(면적먼저형처럼 코드 앞에 전용면적이 오는 경우만): 코드 앞 2칸까지 넓혀 재시도.
      if (!parsed) {
        var segStart2 = Math.max(0, segStart - 2);
        parsed = extractAreaFromTokens(tokens.slice(segStart2, segEnd));
      }
      if (parsed) out.push(parsed);
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
    if (s === '전' || /^전체?$/.test(s)) {
      return { raw: raw, kind: 'all', min: null, max: null, label: label };
    }
    if ((m = s.match(/^(\d+)\s*이상$/))) {
      return { raw: raw, kind: 'above', min: Number(m[1]), max: Infinity, label: label };
    }
    if ((m = s.match(/^(\d+)\s*이하$/))) {
      return { raw: raw, kind: 'below', min: 1, max: Number(m[1]), label: label };
    }
    if ((m = s.match(/^(\d+)\s*[~\-]\s*(\d+)$/))) {
      return { raw: raw, kind: 'range', min: Number(m[1]), max: Number(m[2]), label: label };
    }
    // 쉼표 나열 + 범위 혼합: "5,7,9" / "6,8~9" / "10,12~13"
    if (/^\d+(~\d+)?(\s*,\s*\d+(~\d+)?)+$/.test(s)) {
      var segs = s.split(',').map(function (x) { return x.trim(); });
      var floors = [];
      var isMixed = false;
      segs.forEach(function (seg) {
        var rm = seg.match(/^(\d+)~(\d+)$/);
        if (rm) {
          isMixed = true;
          for (var x = Number(rm[1]); x <= Number(rm[2]); x++) floors.push(x);
        } else {
          floors.push(Number(seg));
        }
      });
      return {
        raw: raw, kind: isMixed ? 'mixed' : 'list', floors: floors,
        min: Math.min.apply(null, floors), max: Math.max.apply(null, floors), label: label
      };
    }
    if ((m = s.match(/^(\d+)$/))) {
      return { raw: raw, kind: 'exact', min: Number(m[1]), max: Number(m[1]), label: label };
    }
    return { raw: raw, kind: 'all', min: null, max: null, label: label };
  }

  // ---------------------------------------------------------------------
  // ② 공급금액 및 납부일정
  // ---------------------------------------------------------------------

  // 표가 행 경계에서 개행/공백 없이 그대로 붙어 복사되는 오염 교정:
  // "189,000,0009층" -> "189,000,000 9층", "194,100,00084OB" -> "194,100,000 84OB"
  // (제대로 된 3자리 콤마 구간 뒤에 여분의 숫자가 곧바로 붙으면 다음 행의 시작이다)
  function fixGluedNumbers(text) {
    return text.replace(/(\d{1,3}(?:,\d{3})+)(\d+)/g, '$1 $2');
  }

  // 헤더 라벨("중도금1차" 등)에 의존하지 않고, 연속된 날짜 토큰의 최장 구간을 중도금 납부일로 추출.
  // 실제 공고문은 "계약 후 30일 이내 2026.12.28. 2027.05.28. ..." 처럼 날짜들이 라벨 없이
  // 나열되는 경우가 많다.
  function detectMidDatesGeneric(tokens) {
    var best = [], cur = [];
    for (var i = 0; i < tokens.length; i++) {
      var d = parseFlexDate(tokens[i]);
      if (d) { cur.push(d); } else { if (cur.length > best.length) best = cur; cur = []; }
    }
    if (cur.length > best.length) best = cur;
    return best.slice(0, 6);
  }

  // 데이터 행 자체에서 "대지비+건축비+(부가세)=합계" 라는 내적 일관성으로 오프셋(합계 위치)과
  // 행당 금액 컬럼 개수를 스스로 알아낸다. 헤더의 회차 라벨이 밀리거나 중복되는 등 깨져 있어도
  // (예: "1차 2차 1차(10%) 2차(10%) 4차(10%) 4차(10%) 5차(10%) 6차(10%)") 영향을 받지 않는다.
  //
  // 첫 번째로 발견된 행 하나만으로 확정하지 않고, 발견되는 모든 후보 행에서 같은 구조
  // (오프셋, 컬럼개수)에 투표하게 해 다수결로 확정한다 - 우연히 산술이 맞아떨어진 행 하나 때문에
  // 잘못된 구조로 고정되는 것을 방지한다.
  // run(행의 금액 값 배열) 안에서, offsetCount 이후 구간 중 "값이 서로 거의 동일하게
  // midCount개 연속되는" 지점을 찾는다. 중도금 회차는 보통 동일 금액(회차별 균등분할)이므로,
  // 이 지점이 곧 mid 블록의 실제 위치다 - down/balance 컬럼 개수를 위치가 아니라 값의
  // 성질로 알아내므로, "잔금 뒤에 융자금처럼 추가 컬럼이 더 있는" 경우에도 정확하다.
  //
  // 변동폭은 절대값이 아니라 평균 대비 비율(상대편차)로 비교한다. 절대편차로 비교하면
  // "계약금(5%+5%)"처럼 다른 구간보다 원래 금액 자체가 작은 구간이, 실제로는 두 값의
  // 차이가 훨씬 큰 비율인데도(예: 500만 vs 4,295만, 약 8.6배 차이) 절대적인 액수 차이가
  // 작다는 이유만으로 "가장 고르게 분할된 구간"으로 잘못 뽑히는 사례가 실사례에서 확인됐다
  // (중도금이 "1차 40% + 2차 10%"처럼 회차별 비율이 다른 경우).
  function findMidBlockStart(run, offsetCount, midCount) {
    var best = -1, bestVariance = Infinity;
    for (var start = offsetCount; start + midCount <= run.length; start++) {
      var slice = run.slice(start, start + midCount);
      var avg = slice.reduce(function (a, b) { return a + b; }, 0) / slice.length;
      var variance = slice.reduce(function (a, b) { return a + Math.abs(b - avg); }, 0) / (avg || 1);
      // 동률(예: 계약금이 우연히 중도금 회차와 같은 금액)이면 더 뒤쪽 위치를 택한다 -
      // 계약금은 관례상 합계 바로 뒤 한 칸이고 중도금 블록은 그다음부터 시작되므로.
      if (variance <= bestVariance) { bestVariance = variance; best = start; }
    }
    return best;
  }

  function detectPriceColumnStructure(tokens) {
    var votes = {};
    var unverifiedVotes = {};
    var exampleRuns = {};
    for (var i = 0; i < tokens.length; i++) {
      if (!isFloorToken(tokens[i])) continue;
      var p = skipFloorPrefix(tokens, i);
      // 세대수(선택) 또는 서브옵션 라벨(선택)을 건너뛴다 - 세대수 컬럼 자체가 없는 표도 지원.
      if (tokens[p] && /^\d{1,3}$/.test(tokens[p]) && isMoneyToken(tokens[p + 1])) p++;
      else if (tokens[p] && isLabelToken(tokens[p]) && isMoneyToken(tokens[p + 1])) p++;
      var run = [];
      var j = p;
      while (j < tokens.length && isMoneyToken(tokens[j])) { run.push(toNum(tokens[j])); j++; }
      if (run.length < 4) continue;
      var candidates = [4, 3];
      var matched = false;
      for (var ci = 0; ci < candidates.length; ci++) {
        var oc = candidates[ci];
        if (run.length <= oc) continue;
        var sum = 0;
        for (var s = 0; s < oc - 1; s++) sum += run[s];
        if (Math.abs(sum - run[oc - 1]) <= 1000) {
          var key = oc + ':' + run.length;
          votes[key] = (votes[key] || 0) + 1;
          if (!exampleRuns[key]) exampleRuns[key] = run;
          matched = true;
          break; // 이 행에서는 첫 매칭 오프셋(부가세 있는 4 우선)만 투표
        }
      }
      if (!matched) {
        // 대지비/건축비 분리 표기가 아예 없는 표(예: "주택가격" 한 컬럼만): 산술로 검증할
        // 수 없으므로, 여러 행에서 같은 컬럼 개수가 일관되게 반복될 때만 근거로 삼는다.
        var ukey = '1:' + run.length;
        unverifiedVotes[ukey] = (unverifiedVotes[ukey] || 0) + 1;
        if (!exampleRuns[ukey]) exampleRuns[ukey] = run;
      }
    }
    var bestKey = null, bestCount = 0;
    Object.keys(votes).forEach(function (k) {
      if (votes[k] > bestCount) { bestCount = votes[k]; bestKey = k; }
    });
    if (!bestKey) {
      Object.keys(unverifiedVotes).forEach(function (k) {
        if (unverifiedVotes[k] > bestCount && unverifiedVotes[k] >= 2) { bestCount = unverifiedVotes[k]; bestKey = k; }
      });
    }
    if (!bestKey) return null;
    var parts = bestKey.split(':');
    return { offsetCount: Number(parts[0]), totalColumnCount: Number(parts[1]), exampleRun: exampleRuns[bestKey] };
  }

  // 헤더가 "대지비 건축비 (부가세) 합계/소계/계 계약시 <날짜×6> 입주시" 형태로 각 컬럼의
  // 의미를 명시하는 실제 공고문 형식을 위한 컬럼맵 빌더.
  //
  // 1) 우선 데이터 자체("대지비+건축비+(부가세)=합계")로 오프셋과 행당 컬럼 개수를 스스로
  //    보정하는 방식을 시도한다(detectPriceColumnStructure) - 헤더 라벨이 아무리 복잡하거나
  //    깨져 있어도(계약금이 여러 회차로 나뉘거나 회차 라벨이 밀려도) 영향을 받지 않는다.
  // 2) 실패하면 "대지비"부터 토큰을 순서대로 읽어 인식 가능한 라벨/날짜가 이어지는 동안만
  //    컬럼으로 채택하는 기존 방식으로 폴백한다.
  function buildPriceColumnMap(tokens, baseDate) {
    var structure = detectPriceColumnStructure(tokens);
    if (structure) {
      var labeledDates = extractMidDates(tokens.join(' '), baseDate).filter(Boolean);
      var genericDates = detectMidDatesGeneric(tokens);
      var midDates = labeledDates.length >= genericDates.length ? labeledDates : genericDates;
      var remaining = structure.totalColumnCount - structure.offsetCount;
      var midCount = midDates.length ? Math.min(midDates.length, remaining) : Math.min(6, Math.max(0, remaining - 1));

      // mid 블록의 실제 위치를 "값이 서로 거의 같게 반복되는 구간"으로 찾는다(위치가 아니라
      // 값의 성질로 판단하므로, 잔금 뒤에 융자금처럼 추가 컬럼이 더 있어도 정확히 처리된다).
      var midStart = (midCount > 0 && structure.exampleRun)
        ? findMidBlockStart(structure.exampleRun, structure.offsetCount, midCount)
        : -1;
      var downCount, afterCount;
      if (midStart >= structure.offsetCount) {
        downCount = midStart - structure.offsetCount;
        afterCount = structure.totalColumnCount - (midStart + midCount);
      } else {
        // mid 블록을 못 찾으면(회차별 금액이 서로 다른 경우 등) 기존의 단순 배치로 폴백:
        // total 바로 뒤 downCount칸, 그다음 mid, 맨 끝 1칸만 balance.
        var hasBalanceFallback = remaining - midCount >= 1;
        downCount = Math.max(0, remaining - midCount - (hasBalanceFallback ? 1 : 0));
        afterCount = hasBalanceFallback ? 1 : 0;
      }

      var map = structure.offsetCount === 1 ? [] : ['land', 'build'];
      if (structure.offsetCount === 4) map.push('vat');
      map.push('total');
      for (var d1 = 0; d1 < downCount; d1++) map.push('down');
      for (var d2 = 0; d2 < midCount; d2++) map.push('mid');
      // mid 이후 남는 칸(잔금 + 융자금처럼 추가 정보가 더 있는 경우 포함)은 모두 balance로
      // 묶는다(합산). 개별 의미(잔금/융자금 등)까지는 구분하지 않지만 분양가 합계 계산에는
      // 영향이 없다.
      for (var d3 = 0; d3 < afterCount; d3++) map.push('balance');

      while (midDates.length < 6) midDates.push(null);
      return { map: map, dataStart: 0, midDates: midDates.slice(0, 6) };
    }

    // 폴백: 헤더를 "대지비"부터 순서대로 읽는 방식
    var startIdx = -1;
    for (var i = 0; i < tokens.length; i++) {
      if (/대지비/.test(tokens[i])) { startIdx = i; break; }
    }
    if (startIdx === -1) return null;

    var map2 = [];
    var midDates2 = [];
    var j = startIdx;
    for (; j < tokens.length; j++) {
      var tok = tokens[j];
      if (/대지비/.test(tok)) { map2.push('land'); continue; }
      if (/건축비/.test(tok)) { map2.push('build'); continue; }
      if (/부가가치세|부가세/.test(tok)) { map2.push('vat'); continue; }
      if (/^(합계|소계|계)$/.test(tok)) { map2.push('total'); continue; }
      if (/계약시/.test(tok)) { map2.push('down'); continue; }
      if (/^입주시$|^입주지정일$/.test(tok)) { map2.push('balance'); j++; break; }
      var dd = parseFlexDate(tok);
      if (dd) { map2.push('mid'); midDates2.push(dd); continue; }
      var off = baseDate ? parseRelativeOffset(tok) : null;
      if (off) { map2.push('mid'); midDates2.push(applyOffset(baseDate, off)); continue; }
      break; // 인식 불가 토큰 -> 헤더 종료, 이 지점부터 데이터
    }

    if (map2.indexOf('land') === -1 || map2.indexOf('build') === -1 || map2.indexOf('total') === -1) return null;
    if (map2.filter(function (k) { return k === 'mid'; }).length < 1) return null;

    while (midDates2.length < 6) midDates2.push(null);
    return { map: map2, dataStart: j, midDates: midDates2.slice(0, 6) };
  }

  function isDongToken(tok) {
    return /^\d/.test(tok) && /(동|호)/.test(tok) && !/층/.test(tok);
  }
  function isFloorToken(tok) {
    // 콤마 구분 금액("60,857" 등)은 층 목록("5,7,9")과 형태가 겹치므로 먼저 배제한다.
    if (isMoneyToken(tok)) return false;
    // 끝에 붙은 콤마/물결/붙임표("11," "5~" 등)까지 허용 - "11, 15층"처럼 층 목록이
    // 공백을 사이에 두고 여러 토큰으로 쪼개진 경우의 앞부분을 인식하기 위함.
    return /층/.test(tok) || /^\d+([~\-,]\d+)*[~\-,]?$/.test(tok);
  }
  // 층 토큰이 공백을 두고 이어지는 경우("5층~ 최상층"의 "최상층"): 층 표기의 연속으로 간주.
  function isFloorContinuation(tok) {
    return /층|최상|이상|이하/.test(tok) && !isMoneyToken(tok);
  }
  // 세대수 컬럼이 없는 표에서 층별 서브옵션을 나타내는 라벨(기본형/마이너스옵션 등):
  // 순수 한글 단어이고 코드/동호 패턴이 아님.
  function isLabelToken(tok) {
    return /^[가-힣]+$/.test(tok);
  }
  function isMoneyToken(tok) {
    return /^\d[\d,]*$/.test(tok) && tok.replace(/,/g, '').length >= 4;
  }
  // 층 토큰(및 이어지는 연속 토큰) 다음 위치에서, 세대수(선택)나 서브옵션 라벨(선택)을
  // 건너뛰고 금액 데이터가 시작되는 인덱스를 반환한다. 세대수도 라벨도 없이 곧장
  // 금액이 이어지는 경우까지 모두 지원(공급세대수 컬럼 자체가 없는 표 대응).
  function skipFloorPrefix(tokens, i) {
    var p = i + 1;
    // "11," "15층"처럼 층 목록이 공백을 사이에 두고 여러 토큰으로 쪼개진 경우: 직전
    // 토큰이 콤마/물결/붙임표로 끝나는 동안은 계속 같은 층 목록의 일부로 흡수한다.
    while (/[~\-,]$/.test(tokens[p - 1]) && tokens[p] && isFloorToken(tokens[p])) p++;
    // 연속 토큰 흡수는 지금까지 흡수한 부분에 이미 명확한 층 표기("층" 포함)가 있을
    // 때만 시도한다. 순수 숫자 하나("2")는 세대수·코드 부속값 등 다른 의미일 수 있어,
    // 그 다음에 오는 진짜 층 토큰("5층")까지 잘못 흡수하지 않도록 막는다.
    if (/층/.test(tokens[i]) || /층/.test(tokens[p - 1])) {
      while (tokens[p] && isFloorContinuation(tokens[p])) p++;
    }
    return p;
  }

  // colMap.length개의 금액이 오는 위치를 찾는다: 세대수(숫자, 선택) 또는 서브옵션
  // 라벨(기본형/마이너스옵션 등, 선택) 다음, 혹은 둘 다 없이 곧장. 찾으면 값들을 colMap에
  // 따라 집계해 반환한다.
  function readMoneyRun(tokens, p, colMap, unit_mult) {
    var units = null, label = null, sliceStart = p;
    if (tokens[p] && /^\d{1,3}$/.test(tokens[p])) {
      var s1 = tokens.slice(p + 1, p + 1 + colMap.length);
      if (s1.length === colMap.length && s1.every(isMoneyToken)) { units = Number(tokens[p]); sliceStart = p + 1; }
    }
    if (units === null && tokens[p] && isLabelToken(tokens[p])) {
      var s2 = tokens.slice(p + 1, p + 1 + colMap.length);
      if (s2.length === colMap.length && s2.every(isMoneyToken)) { label = tokens[p]; sliceStart = p + 1; }
    }
    var slice = tokens.slice(sliceStart, sliceStart + colMap.length);
    if (slice.length !== colMap.length || !slice.every(isMoneyToken)) return null;

    var values = { mid: [] };
    colMap.forEach(function (kind, ci) {
      var v = toNum(slice[ci]) * unit_mult;
      if (kind === 'mid') values.mid.push(v);
      else if (kind === 'down') values.down = (values.down || 0) + v;
      else if (kind === 'balance') values.balance = (values.balance || 0) + v;
      else values[kind] = v;
    });
    return { units: units, label: label, values: values, nextIndex: sliceStart + colMap.length };
  }

  // 헤더 컬럼맵을 이용해 코드/동호수가 매 행마다 반복되지 않고 이어지는(carry-forward)
  // 실제 공고문 표를 파싱한다. 코드가 나오면 새 주택형으로, 동호수가 나오면 그 동호수로
  // 갱신하고, "층구분 + 세대수 + (컬럼맵 길이)개의 금액" 패턴을 만나면 한 행으로 확정한다.
  function scanPriceRowsWithMap(tokens, dataStart, colMap, codeSet, unit_mult) {
    var rows = [];
    var currentCode = null;
    var currentDong = '';
    var currentFloorRaw = null; // 세대수 없이 서브옵션(기본형/마이너스옵션)만 이어지는 행을 위해 직전 층을 기억
    var lastDongIdx = -1; // 직전 토큰이 동/호 토큰이었는지 (예: "101동" "2·3호" 두 토큰을 이어붙이기 위함)
    var i = dataStart;
    var n = tokens.length;

    function pushRow(floorRaw, r) {
      rows.push({
        code: currentCode,
        floor: parseFloorDesc(floorRaw),
        // 세대수 컬럼이 없는 표에서는 서브옵션 라벨(기본형/마이너스옵션 등)을
        // 동/라인 칸에 대신 표시해 두 행을 구분할 수 있게 한다.
        dong: r.label ? (currentDong ? currentDong + ' ' + r.label : r.label) : currentDong,
        units: r.units != null ? r.units : 1,
        price: r.values.total,
        down_payment: r.values.down != null ? r.values.down : null,
        down_is_ratio: false,
        down_ratio: null,
        land: r.values.land,
        build: r.values.build,
        vat: r.values.vat,
        balance: r.values.balance,
        mid_amounts: r.values.mid
      });
    }

    while (i < n) {
      var tok = tokens[i];

      var isCode = codeSet ? (codeSet.indexOf(tok) !== -1) : (SHORT_CODE_RE.test(tok) || LONG_CODE_RE.test(tok));
      if (isCode) { currentCode = tok; currentDong = ''; currentFloorRaw = null; lastDongIdx = -1; i++; continue; }

      if (isDongToken(tok)) {
        currentDong = (lastDongIdx === i - 1) ? (currentDong + ' ' + tok) : tok;
        lastDongIdx = i;
        i++; continue;
      }

      if (isFloorToken(tok) && currentCode) {
        var p = skipFloorPrefix(tokens, i);
        var floorRaw = tokens.slice(i, p).join(' ');
        var r = readMoneyRun(tokens, p, colMap, unit_mult);
        if (r) {
          pushRow(floorRaw, r);
          currentFloorRaw = floorRaw;
          i = r.nextIndex;
          continue;
        }
      }

      // 세대수 컬럼이 없는 표에서, 같은 층에 서브옵션(기본형/마이너스옵션 등)만 이어지는
      // 행: 새 층 토큰 없이 라벨이 곧장 나온다. 직전 층을 그대로 이어받는다.
      if (isLabelToken(tok) && currentCode && currentFloorRaw != null) {
        var r2 = readMoneyRun(tokens, i, colMap, unit_mult);
        if (r2) {
          pushRow(currentFloorRaw, r2);
          i = r2.nextIndex;
          continue;
        }
      }

      i++;
    }
    return rows;
  }

  function parsePriceSection(text, codes, baseDate) {
    text = fixGluedNumbers(despaceKeywords(String(text || '')));
    var hdr = parseTableHeader(text, baseDate);
    var unit_mult = hdr.unit_mult;
    var codeSet = codes && codes.length ? codes.slice() : null;

    // 1) 헤더 컬럼맵 우선 시도: 실제 공고문처럼 "대지비 건축비 합계 계약시 <날짜×6> 입주시"가
    //    명시된 경우, 표가 통째로 한 줄이거나 코드/동호수가 행마다 반복되지 않아도 정확히 파싱된다.
    var allTokens = text.split(/\s+/).filter(Boolean);
    var colInfo = buildPriceColumnMap(allTokens, baseDate);
    if (colInfo) {
      var rows = scanPriceRowsWithMap(allTokens, colInfo.dataStart, colInfo.map, codeSet, unit_mult);
      if (rows.length) {
        return { midDates: colInfo.midDates, priceRows: rows, unit_mult: unit_mult };
      }
    }

    // 2) 폴백: 헤더에 명시적 컬럼 구조가 없는 단순 표 형식 (기존 라인 단위 휴리스틱)
    var midDates = hdr.midDates;
    var priceRows = [];
    var ls = expandMegaLines(lines(text), codeSet);

    for (var i = 0; i < ls.length; i++) {
      var line = ls[i];
      if (/^\(?\s*단위/.test(line)) continue;

      var toks = tokenize(line);
      if (toks.length < 2) continue;

      var code = null;
      var consumed = [];
      if (codeSet) {
        var found = findCodesInLine(line, codeSet);
        if (found.codes.length) { code = found.codes[0]; consumed = found.consumed; }
      }
      if (!code) {
        for (var t = 0; t < toks.length; t++) {
          if (SHORT_CODE_RE.test(toks[t])) { code = toks[t]; break; }
        }
        if (!code) {
          for (var t3 = 0; t3 < toks.length; t3++) {
            if (LONG_CODE_RE.test(toks[t3])) { code = toks[t3]; break; }
          }
        }
      }
      if (!code) continue;
      if (codeSet && codeSet.indexOf(code) === -1) continue;

      // 층구분 탐색: '층' 포함 토큰이거나 숫자/범위/쉼표 패턴 (코드 조각으로 소비된 토큰은 제외)
      var floorTok = null;
      for (var f = 0; f < toks.length; f++) {
        var tk = toks[f];
        if (tk === code || consumed.indexOf(tk) !== -1) continue;
        if (/층|이상|이하/.test(tk) || /^\d+([~\-,]\d+)*$/.test(tk)) {
          floorTok = tk;
          break;
        }
      }
      floorTok = floorTok || '전체';
      var floor = parseFloorDesc(floorTok);

      var dong = extractDong(line);

      var moneyToks = toks.filter(function (tk) {
        return /^\d[\d,]*$/.test(tk) && tk.replace(/,/g, '').length >= 4;
      }).map(toNum);

      if (!moneyToks.length) continue;

      var price = Math.max.apply(null, moneyToks) * unit_mult;

      // 계약금: %) 비율(단일 또는 분납 합산, 예: "5%+5%" -> 10%) 우선, 없으면 최소 금액을 정액으로 간주
      var ratioMatches = line.match(/\d{1,2}(?:\.\d+)?\s*%/g);
      var down_is_ratio = !!(ratioMatches && ratioMatches.length);
      var down_ratio = down_is_ratio
        ? ratioMatches.reduce(function (sum, r) { return sum + parseFloat(r) / 100; }, 0)
        : null;
      var down_payment = down_is_ratio ? null : (moneyToks.length ? Math.min.apply(null, moneyToks) * unit_mult : null);

      var unitsTok = toks.filter(function (tk) { return tk !== code && consumed.indexOf(tk) === -1 && /^\d{1,3}$/.test(tk); });
      var units = unitsTok.length ? Number(unitsTok[0]) : null;

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

  // N안형/N대형/기본·전실형 모두 "여러 후보(그룹) 중 최소 금액 채택"으로 귀결된다.
  // 각 코드(또는 묶음형처럼 여러 코드가 한 그룹을 공유)마다 "그 그룹에서 처음 나오는 금액"만
  // 후보로 취하고(총액/공급금액이 통상 가장 먼저 오고, 계약금·잔금 등 분할내역이 뒤따르므로),
  // 코드가 반복 등장하며 그룹이 바뀔 때마다 새 후보를 추가해 그 중 최솟값을 취한다.
  // 코드 없이 이어지는 설명행(안/대수/기본형/마이너스옵션 등)은 직전 그룹의 코드를 이어받아
  // 새 그룹을 연다. 특정 단어 목록("기본"/"전실" 등)을 나열하는 대신, "숫자+한글"(1안/4대 등)
  // 이거나 순수 한글 단어(isLabelToken - 기본형/마이너스옵션/전실 등 무엇이든)이면 전부
  // 연속행 트리거로 인정해 새 단어가 나올 때마다 목록을 늘리지 않아도 되게 한다.
  var CONTINUATION_RE = /^\d+\s*[가-힣]+/;

  function scanAmountGroups(tokens, codeSet) {
    var groups = [];
    var current = null;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var codesHere = [];
      if (codeSet) {
        tok.split(/[,，·/]/).filter(Boolean).forEach(function (p) {
          if (codeSet.indexOf(p) !== -1) codesHere.push(p);
        });
      } else if (SHORT_CODE_RE.test(tok) || LONG_CODE_RE.test(tok)) {
        codesHere = [tok];
      }

      if (codesHere.length) {
        if (current && current.startedByCode && current.firstMoney === null) {
          current.codes = current.codes.concat(codesHere);
        } else {
          current = { codes: codesHere.slice(), firstMoney: null, startedByCode: true };
          groups.push(current);
        }
        continue;
      }

      if (isMoneyToken(tok) && current) {
        if (current.firstMoney === null) current.firstMoney = toNum(tok);
        continue;
      }

      if ((CONTINUATION_RE.test(tok) || isLabelToken(tok)) && groups.length) {
        current = { codes: groups[groups.length - 1].codes.slice(), firstMoney: null, startedByCode: false };
        groups.push(current);
      }
    }
    return groups;
  }

  function parseAmountByCodeSection(text, codes) {
    text = fixGluedNumbers(despaceKeywords(String(text || '')));
    var unit_mult = detectUnitMult(headerText(text));
    var codeSet = codes && codes.length ? codes.slice() : null;
    var tokens = text.split(/\s+/).filter(Boolean);
    var groups = scanAmountGroups(tokens, codeSet);

    var candidates = {};
    groups.forEach(function (g) {
      if (g.firstMoney == null) return;
      g.codes.forEach(function (c) {
        candidates[c] = (candidates[c] || []).concat([g.firstMoney]);
      });
    });

    var result = {};
    Object.keys(candidates).forEach(function (c) {
      result[c] = Math.min.apply(null, candidates[c]) * unit_mult;
    });
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

  function extractMeta(text) {
    var open_date = null;
    var move_in_year = null;
    var move_in_month = null;

    var openM = text.match(/(?:입주자\s*모집\s*)?공고일\s*[:：]?\s*([0-9.\-/년월일\s]{6,20})/);
    if (openM) open_date = parseFlexDate(openM[1]);
    if (!open_date) {
      // "...-12156호(2024.02.28.)로 입주자모집공고 승인" 처럼 승인/신고 문구 앞의 날짜로 공고일을 대신 표기하는 경우
      var openM2 = text.match(/(\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2})\s*\.?\s*[).）][^\n]{0,40}(?:입주자\s*모집\s*공고\s*승인|분양\s*신고\s*처리|분양\s*신고|승인|신고)/);
      if (openM2) open_date = parseFlexDate(openM2[1]);
    }

    // "입주예정월", "입주예정일", "입주시기"(예정 없이) 등 표기 변형 모두 지원
    var moveM = text.match(/입주\s*(?:예정\s*)?(?:월|일|시기)?\s*[:：]?\s*(\d{4})\s*[년.\-]\s*(\d{1,2})\s*월?/);
    if (moveM) {
      move_in_year = Number(moveM[1]);
      move_in_month = Number(moveM[2]);
    }

    return { open_date: open_date, move_in_year: move_in_year, move_in_month: move_in_month };
  }

  // ---------------------------------------------------------------------
  // PDF 전체 원문에서 4개 섹션(공급면적/공급금액/발코니/옵션) 경계 자동 분리
  //
  // 실제 분양광고 PDF들은 예외 없이 "■"(U+25A0) 또는 "▣"(U+25A3) 불릿으로 시작하는
  // 섹션 제목 뒤에 해당 표가 곧바로 이어지는 관례를 따른다(디스클레이머 불릿은 "⦁"/"•"
  // 등 다른 문자를 쓰므로 섞이지 않는다). 이 불릿+제목 조합을 앵커로 삼아 각 섹션의
  // 시작 위치를 찾고, 다음 앵커(또는 "청약신청자격 및 공급일정"처럼 명확한 다음
  // 대분류 제목) 직전까지를 그 섹션 텍스트로 자른다. 앵커를 못 찾으면 빈 문자열을
  // 반환하므로, 호출측(UI)에서 실패 시 원문 전체를 보여주고 사용자가 직접 붙여넣기로
  // 대체할 수 있게 해야 한다.
  // ---------------------------------------------------------------------

  var SECTION_ANCHORS = {
    area: [/[■▣]\s*공급대상\s*(?:및\s*공급규모)?(?!물)/],
    price: [/[■▣]\s*공급금액\s*및\s*납부일정/, /[■▣]\s*분양가격\s*납부조건\s*등?\s*안내/, /[■▣]\s*공급금액\s*납부조건\s*등?\s*안내/],
    balcony: [/[■▣]\s*발코니\s*확장/],
    option: [/[■▣]\s*추가\s*선택\s*옵션품목/, /[■▣]\s*추가선택\s*옵션품목/, /[■▣]\s*옵션품목/, /[■▣]\s*추가\s*선택품목/]
  };
  var NEXT_MAJOR_SECTION_RE = /청약신청\s*자격\s*및\s*공급일정/;

  function findEarliestMatch(text, patterns, fromIndex) {
    var searchFrom = fromIndex || 0;
    var sub = text.slice(searchFrom);
    var best = -1;
    for (var i = 0; i < patterns.length; i++) {
      var m = sub.match(patterns[i]);
      if (m && m.index != null) {
        var idx = searchFrom + m.index;
        if (best === -1 || idx < best) best = idx;
      }
    }
    return best;
  }

  function sliceSection(text, start, endCandidates) {
    if (start < 0) return '';
    var end = text.length;
    for (var i = 0; i < endCandidates.length; i++) {
      var c = endCandidates[i];
      if (c >= 0 && c > start && c < end) end = c;
    }
    return text.slice(start, end).trim();
  }

  function splitDocumentSections(fullText) {
    var text = String(fullText || '');
    var areaStart = findEarliestMatch(text, SECTION_ANCHORS.area, 0);
    var priceSearchFrom = areaStart >= 0 ? areaStart + 1 : 0;
    var priceStart = findEarliestMatch(text, SECTION_ANCHORS.price, priceSearchFrom);
    var afterPrice = priceStart >= 0 ? priceStart + 1 : priceSearchFrom;
    var balconyStart = findEarliestMatch(text, SECTION_ANCHORS.balcony, afterPrice);
    var optionSearchFrom = balconyStart >= 0 ? balconyStart + 1 : afterPrice;
    var optionStart = findEarliestMatch(text, SECTION_ANCHORS.option, optionSearchFrom);
    var nextMajorStart = findEarliestMatch(text, [NEXT_MAJOR_SECTION_RE], afterPrice);

    var area = sliceSection(text, areaStart, [priceStart]);
    var price = sliceSection(text, priceStart, [balconyStart, optionStart, nextMajorStart]);
    var balcony = sliceSection(text, balconyStart, [optionStart, nextMajorStart]);
    var option = sliceSection(text, optionStart, [nextMajorStart]);

    return {
      area: area,
      price: price,
      balcony: balcony,
      option: option,
      found: { area: areaStart >= 0, price: priceStart >= 0, balcony: balconyStart >= 0, option: optionStart >= 0 }
    };
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
    splitDocumentSections: splitDocumentSections,
    // 디버그/QA용 내부 함수 노출
    parseTableHeader: parseTableHeader,
    parseFloorDesc: parseFloorDesc,
    detectUnitMult: detectUnitMult,
    detectOffset: detectOffset,
    extractMidDates: extractMidDates,
    parseFlexDate: parseFlexDate,
    parseRelativeOffset: parseRelativeOffset,
    despaceKeywords: despaceKeywords,
    extractDong: extractDong
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  for (var k in api) { root[k] = api[k]; }
})(typeof window !== 'undefined' ? window : globalThis);
