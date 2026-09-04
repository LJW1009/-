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

  // 짧은형 코드: 84A, 54A1, 84OA, 200A, 84O, 84E1-T(하이픈 접미사) 등 (점(.) 없는 숫자+영문 조합).
  // 하이픈 접미사에 숫자까지 붙는 문서도 있다(117C-T1/118C-T2 등 - 실사례: 목동윤슬자이
  // 오피스텔).
  var SHORT_CODE_RE = /^\d{2,4}[A-Za-z]{1,3}\d{0,2}(?:-[A-Za-z]{1,3}\d{0,2})?$/;
  // 긴 소수형 코드: 059.9700A (문자 접미사 필수 - 없으면 순수 면적값과 구분 불가)
  var LONG_CODE_RE = /^\d{2,3}\.\d{2,4}[A-Za-z]{1,2}$/;
  // 문자 접미사 없는 긴 소수형 관리코드: 036.9653 (같은 표 안에 59A/84A처럼 레터 접미사가
  // 붙는 타입과, 36/45처럼 동·호 구분이 필요 없어 접미사가 없는 타입이 함께 나오는 문서 대응).
  // 형태만으로는 순수 면적값과 구분 불가하므로 findSelfConsistentBareCodeBoundaries에서
  // "이 값이 몇 토큰 뒤 전용면적 데이터로 그대로 반복 등장하는지"를 검증한 것만 인정한다.
  var BARE_LONG_CODE_RE = /^\d{2,3}\.\d{2,4}$/;

  // 공급면적표는 "약식표기(84A)"와 "긴 코드(084.9944A)"를 나란히 표기하지만, 공급금액표는
  // 짧은 약식표기 없이 긴 코드만으로 주택형을 구분하는 문서가 있다(실사례: 부산에코델타시티
  // 디에트르 더 퍼스트(28BL) - 공급면적표는 "약식표기" 칸이 있지만 공급금액표는 "084.9944A"
  // 처럼 긴 코드로만 표기). 이때 area 섹션에서 넘어온 codeSet(약식표기 목록)만으로 코드를
  // 매칭하면 공급금액표의 행을 하나도 못 찾는다. 긴 코드의 소수점 앞 정수부(앞자리 0 제거)에
  // 말미 문자를 그대로 붙이면 약식표기와 정확히 같아지는 산술적 관계("084"→84, "110"→110)를
  // 이용해, 헤더 문구가 아니라 숫자 자체의 변환으로 별칭을 판별한다.
  function longCodeToShortCandidate(tok) {
    var m = /^(\d{2,3})\.(\d{2,4})([A-Za-z]{1,2})$/.exec(String(tok || ''));
    if (!m) return null;
    return String(Number(m[1])) + m[3];
  }

  // BARE_LONG_CODE_RE에 매칭된 토큰이 실제 "관리코드"(전용면적을 소수점 자릿수만 다르게 그대로
  // 반복 표기, 예: "036.9653" → 몇 토큰 뒤 "36.9653")인지, 우연히 그 값 그대로인 일반 면적
  // 데이터값(주거공용/계약면적 등, 값이 서로 겹치지 않는 게 보통)인지를 자기참조 중복으로
  // 가려낸다. 표 헤더의 코드 나열(공고상 표기 안내 목록)처럼 근처에 반복이 없는 경우는
  // 자연스럽게 걸러진다.
  function findSelfConsistentBareCodeBoundaries(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!BARE_LONG_CODE_RE.test(tokens[i])) continue;
      var v = Number(tokens[i]);
      for (var j = i + 1; j < Math.min(tokens.length, i + 6); j++) {
        if (/^\d+\.\d+$/.test(tokens[j]) && Math.abs(Number(tokens[j]) - v) < 0.0001) { out.push(i); break; }
      }
    }
    return out;
  }

  // 일부 문서는 표 셀 안에서 약식표기가 "130\nA1"처럼 숫자 접두부와 문자 접미부가 서로 다른
  // 줄로 나뉘어 있어(칸이 좁아 줄바꿈), PDF 추출 시 둘 사이에 공백이 남아 별개 토큰("130",
  // "A1")으로 쪼개진다(실사례: 광주 한 아파트 분양공고 - "130A1"/"130A2"가 이렇게 쪼개져
  // SHORT_CODE_RE에 전혀 매칭되지 않고, 숫자만 코드로 오인돼 A1/A2 두 타입이 "130" 하나로
  // 뭉개지며 세대수도 뒤에 나온 값으로 덮어써졌다). 숫자 토큰 바로 뒤에 문자(+숫자 0~2자리)
  // 접미부가 오고 합친 결과가 SHORT_CODE_RE와 일치하며, 근처(다음 몇 토큰 안)에 그 숫자
  // 접두부와 정수부가 똑같은 실수(전용면적 등, 실제로 이 숫자가 그 타입의 코드라는 증거)가
  // 있을 때만 두 토큰을 하나로 합친다 - 우연히 숫자 뒤에 무관한 글자 토큰이 오는 경우까지
  // 잘못 합치지 않도록 구조적 근거를 요구한다.
  function reglueSplitShortCodes(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var cur = tokens[i], next = tokens[i + 1];
      if (next && /^\d{2,4}$/.test(cur) && /^[A-Za-z]{1,3}\d{0,2}$/.test(next)) {
        var combined = cur + next;
        if (SHORT_CODE_RE.test(combined)) {
          var verified = false;
          for (var k = i + 2; k < Math.min(tokens.length, i + 6); k++) {
            var fm = /^(\d+)\.\d+$/.exec(tokens[k]);
            if (fm && Number(fm[1]) === Number(cur)) { verified = true; break; }
          }
          if (verified) { out.push(combined); i++; continue; }
        }
      }
      out.push(cur);
    }
    return out;
  }

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

    var floatIdxs = floats.map(function (f) { return f.idx; });
    var firstFloatIdx = Math.min.apply(null, floatIdxs);
    var maxFloatIdx = Math.max.apply(null, floatIdxs);

    // 코드: 1) 짧은형(84A 등) 2) 긴 소수형(084.9750A 등) 3) 면적값 바로 옆 순수정수(마지막 수단)
    // 탐색 범위를 세그먼트 맨 앞(첫 면적값 전후)으로 한정한다 - 세그먼트 경계가 "약식표기(짧은형)
    // 코드" 자체로 잡혀 있으면, 바로 그 앞 토큰인 같은 행의 "긴 소수형" 코드가 이전 세그먼트의
    // 꼬리로 밀려들어간다(예: "...45 45.9344... 059.8216A | 59A 59.8216..." - 앞 세그먼트 끝에
    // 다음 행의 "059.8216A"가 붙음). 세그먼트 전체를 뒤져 코드를 찾으면 이 꼬리 오염이 실제
    // 코드보다 먼저 매치되어 엉뚱한 코드로 뒤바뀔 수 있으므로, 코드는 항상 데이터 값(면적) 바로
    // 앞/뒤에 붙어 있다는 구조적 전제 하에 탐색 범위를 좁힌다.
    var codeSearchEnd = Math.min(toks.length, firstFloatIdx + 2);
    var code = null;
    for (var t = 0; t < codeSearchEnd; t++) {
      if (SHORT_CODE_RE.test(toks[t])) { code = toks[t]; break; }
    }
    if (!code) {
      for (var t2 = 0; t2 < codeSearchEnd; t2++) {
        if (LONG_CODE_RE.test(toks[t2])) { code = toks[t2]; break; }
      }
    }
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
    tokens = reglueSplitShortCodes(tokens);

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

    // 같은 코드가 경계 후보로 두 번 이상 잡히는 문서가 있다(실사례: 부산에코델타시티 디에트르
    // 더 퍼스트 - 실제 데이터 표 뒤에 "■ 주택형 표시 안내"라는 코드만 다시 나열하는 매핑 표가
    // 있어 "84A 84B 84C ..."가 한 번 더 경계로 잡힌다). 매핑 표의 코드 나열은 뒤에 다시 코드(가
    // 아니면 아무 소수 면적값도 없이) 이어지지만, 실제 데이터 행은 항상 코드 바로 뒤에 소수
    // 면적값이 온다는 구조적 차이로 실제 데이터 행만 남긴다(해당 코드에 그런 occurrence가 하나도
    // 없으면 판단 근거가 없으므로 원래대로 전부 남겨 안전하게 후퇴한다).
    var boundariesByCode = {};
    boundaries.forEach(function (idx) { var c = tokens[idx]; (boundariesByCode[c] = boundariesByCode[c] || []).push(idx); });
    Object.keys(boundariesByCode).forEach(function (c) {
      var occ = boundariesByCode[c];
      if (occ.length < 2) return;
      var withFloatNext = occ.filter(function (idx) { return /^\d+\.\d+$/.test(tokens[idx + 1] || ''); });
      if (withFloatNext.length && withFloatNext.length < occ.length) {
        var keep = {};
        withFloatNext.forEach(function (idx) { keep[idx] = true; });
        boundaries = boundaries.filter(function (idx) { return tokens[idx] !== c || keep[idx]; });
      }
    });

    // 레터 접미사형(59A 등)과 무접미사 관리코드형(036.9653 등)이 한 표 안에 섞여 있는 문서 대응:
    // 자기참조 검증을 통과한 무접미사 경계도 추가로 합친다(둘 다 없거나 둘 다 있어도 안전).
    var bareBoundaries = findSelfConsistentBareCodeBoundaries(tokens);
    if (bareBoundaries.length) {
      bareBoundaries.forEach(function (idx) { if (boundaries.indexOf(idx) === -1) boundaries.push(idx); });
      boundaries.sort(function (a, b) { return a - b; });
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
    // 바로 뒤에 "계" 한 글자만 오는 경우("계 24")는 모든 주택형 코드가 최소 한 번씩 다
    // 등장한 뒤에 나올 때만 총계로 인정한다(다른 문맥의 "계" 단어와 혼동하지 않도록).
    // 데이터 표 뒤에 같은 코드를 다시 나열하는 별도 요약표가 딸린 문서도 있다(실사례: 목동윤슬자이
    // 오피스텔 - 진짜 표 뒤에 "특별공급 세대수" 표가 같은 코드를 다시 나열하며 자기 "합계"행으로
    // 끝남). 이 경우 boundaries에 요약표 쪽 경계까지 섞여 "마지막 경계"가 요약표 쪽으로 훨씬
    // 밀리므로, "마지막 경계"가 아니라 "모든 코드가 처음으로 한 바퀴 다 나온 시점"을 기준으로
    // 삼아야 진짜 표의 총계행("계 651 -")에서 멈춘다(요약표까지 기다리지 않음).
    var distinctCodes = {};
    boundaries.forEach(function (idx) { distinctCodes[tokens[idx]] = true; });
    var distinctCount = Object.keys(distinctCodes).length;
    var firstFullBoundary = boundaries[boundaries.length - 1];
    var seenCodes = {}, seenCount = 0;
    for (var bi = 0; bi < boundaries.length; bi++) {
      var code = tokens[boundaries[bi]];
      if (!seenCodes[code]) { seenCodes[code] = true; seenCount++; }
      if (seenCount >= distinctCount) { firstFullBoundary = boundaries[bi]; break; }
    }
    var totalIdx = tokens.length;
    for (var ti = 0; ti < tokens.length; ti++) {
      var isTotalRow = /^합계$/.test(tokens[ti]) ||
        (/^합$/.test(tokens[ti]) && tokens[ti + 1] && /^계$/.test(tokens[ti + 1])) ||
        (/^계$/.test(tokens[ti]) && ti > firstFullBoundary && tokens[ti + 1] && /^\d+$/.test(tokens[ti + 1]));
      if (isTotalRow) { totalIdx = ti; break; }
    }

    // "합계" 행 뒤에 "주택형 표시 안내"/"특별공급 공급세대수"처럼 코드가 다시 요약·나열되는
    // 부가 표가 이어지는 문서가 있다(실사례: 부산 장안지구 B-2블록 중흥S-클래스). 이런
    // 부가 표의 코드 언급이 boundaries에 섞여 있으면, 마지막 실제 주택형의 세그먼트가
    // "다음 경계"를 그 부가 표 쪽 코드로 잘못 잡아 합계 행까지(그리고 그 사이 부가 표 일부까지)
    // 통째로 삼켜버린다. 합계 행 이후에 나오는 경계는 전부 부가 표에서 온 것이므로 제거한다.
    if (totalIdx < tokens.length) {
      boundaries = boundaries.filter(function (b) { return b < totalIdx; });
    }
    if (!boundaries.length) return [];

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
      while (j < tokens.length && isMoneyOrZeroToken(tokens[j])) { run.push(moneyOrZeroValue(tokens[j])); j++; }
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
  // 동/호 목록이 "113동 3, 4, 5호"처럼 쉼표로 나열되며 여러 토큰으로 쪼개진 경우, 중간의
  // "3," "4," 같은 조각은 그 자체로는 isDongToken이 아니다(동/호 글자가 없음). 이런 조각도
  // 직전 토큰이 동/호 목록의 일부였을 때만(호출측에서 lastDongIdx로 판단) 이어붙일 수 있도록,
  // "숫자/쉼표/가운뎃점/슬래시로만 이루어지고 쉼표·동·호로 끝나는" 형태적 특징만으로 판별한다
  // (실제 값이 아니라 표기 형태로 구분 - 세대수 같은 독립된 숫자는 쉼표로 끝나지 않는다).
  function isDongContinuationToken(tok) {
    if (!/[,·/동호]$/.test(tok)) return false;
    return /^[\d,·/]+(동|호)?$/.test(tok);
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
  // "-" 한 글자는 "해당 항목 없음(0원)"을 뜻하는 표기 관례(예: 부가세 면제 주택의 부가가치세
  // 칸). 금액 나열이 이 자리에서 끊기면 대지비+건축비+(부가세)=합계 같은 행 전체의 산술
  // 일관성 검증이 실패해 컬럼 구조를 아예 못 찾게 되므로, 금액 자리에서만 값 0으로 취급한다
  // (isFloorToken/isLabelToken 등 다른 판별에는 영향 없음 - "-"는 그쪽 정규식에 매칭되지 않음).
  function isMoneyOrZeroToken(tok) {
    return isMoneyToken(tok) || tok === '-';
  }
  function moneyOrZeroValue(tok) {
    return tok === '-' ? 0 : toNum(tok);
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
    // "10층(최상층 119동 4,5호, 120동 4,5호, ...)"처럼 층 표기 자체에 괄호가 붙어 시작하는
    // 경우도, "최상층\n(107동 1,4호,\n108동 3호)"처럼 층 표기 다음 토큰부터 새로 괄호가
    // 열리는 경우도 있다(실사례: 부산에코델타시티 디에트르 더 퍼스트(28BL), 북수원이목지구
    // 대방 디에트르 더 리체Ⅰ(A4BL) - 같은 층에 동/호가 갈리는 하위 그룹을 괄호로 부연
    // 설명). 괄호 안에 동/호 표기가 섞여 있으면 isDongToken 등이 그걸 별개의 동/호 갱신으로
    // 잘못 흡수하고, 뒤이어 나오는 진짜 세대수 숫자가 새 층 목록으로 오인되어 세대수가
    // 유실된다. 특정 키워드가 아니라 "괄호가 아직 안 닫혔다"는 형태적 규칙으로, 이미 열린
    // 괄호가 있거나 다음 토큰이 새로 괄호를 열면 닫힐 때까지 그 안의 어떤 토큰이든 같은 층
    // 설명의 일부로 계속 흡수한다("층" 표기가 있는 경우로 한정해 무관한 문맥의 괄호까지
    // 잘못 삼키지 않도록 한다).
    if (/층/.test(tokens[i]) || /층/.test(tokens[p - 1])) {
      var openCount = 0, closeCount = 0;
      for (var pk = i; pk < p; pk++) {
        openCount += (tokens[pk].match(/\(/g) || []).length;
        closeCount += (tokens[pk].match(/\)/g) || []).length;
      }
      while (tokens[p] && (openCount > closeCount || /\(/.test(tokens[p]))) {
        openCount += (tokens[p].match(/\(/g) || []).length;
        closeCount += (tokens[p].match(/\)/g) || []).length;
        p++;
      }
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
      if (s1.length === colMap.length && s1.every(isMoneyOrZeroToken)) { units = Number(tokens[p]); sliceStart = p + 1; }
    }
    if (units === null && tokens[p] && isLabelToken(tokens[p])) {
      var s2 = tokens.slice(p + 1, p + 1 + colMap.length);
      if (s2.length === colMap.length && s2.every(isMoneyOrZeroToken)) { label = tokens[p]; sliceStart = p + 1; }
    }
    var slice = tokens.slice(sliceStart, sliceStart + colMap.length);
    if (slice.length !== colMap.length || !slice.every(isMoneyOrZeroToken)) return null;

    var values = { mid: [] };
    colMap.forEach(function (kind, ci) {
      var v = moneyOrZeroValue(slice[ci]) * unit_mult;
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
    // 무작위 배정 등으로 여러 코드가 가격표를 통째로 공유하는 문서가 있다(실사례: 봉선동
    // 르 오네뜨 2차 - "130A1\n130A2" 두 약식표기가 바로 붙어 나온 뒤 층별 행이 한 세트만
    // 이어짐. 같은 주택형 130.0926에 속하고 동·호수가 무작위 배정되어 두 타입의 분양가가
    // 완전히 동일하기 때문). 반대로 코드 두 개가 나란히 언급되지만 실제로는 그냥 안내문일
    // 뿐, 각자 자기만의 데이터 행을 따로 가진 문서도 있다(실사례: 북수원이목지구 대방
    // 디에트르 더 리체Ⅰ - "견본주택 등의 약식표기 84B 84C" 매핑 안내 줄 뒤에 84B/84C가
    // 각각 별도의 전체 데이터 블록을 갖는다). 토큰 형태만으로는 이 둘을 구분할 수 없어,
    // "이 코드가 가격 섹션 전체에서 정확히 한 번만 등장하는가"를 근거로 삼는다 - 진짜
    // 공유 그룹의 코드는 그 공유 지점에서 유일하게 한 번만 나오는 반면(그 뒤에 이어지는
    // 데이터는 코드 없이 층 정보만으로 이어짐), 안내문에 나온 코드는 뒤에 자기 이름으로
    // 시작하는 데이터 블록이 따로 있어 최소 두 번 이상 등장한다. 별칭으로 해석된 코드
    // (예: "059.0000A"가 우연히 실제 하위타입 코드 "59A"와 같아지는 경우 - 실사례:
    // 고양창릉 S-4블록)는 이 판단 자체가 무의미하므로 애초에 공유 후보에서 제외한다.
    var directOccurCount = {};
    if (codeSet) {
      for (var oi = dataStart; oi < tokens.length; oi++) {
        if (codeSet.indexOf(tokens[oi]) !== -1) directOccurCount[tokens[oi]] = (directOccurCount[tokens[oi]] || 0) + 1;
      }
    }
    var currentCodes = [];
    var groupHasRows = false;
    var groupIsShareable = false;
    var currentDong = '';
    var currentFloorRaw = null; // 세대수 없이 서브옵션(기본형/마이너스옵션)만 이어지는 행을 위해 직전 층을 기억
    var lastDongIdx = -1; // 직전 토큰이 동/호 토큰이었는지 (예: "101동" "2·3호" 두 토큰을 이어붙이기 위함)
    var i = dataStart;
    var n = tokens.length;

    function pushRow(floorRaw, r) {
      currentCodes.forEach(function (code) {
        rows.push({
          code: code,
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
      });
      groupHasRows = true;
    }

    while (i < n) {
      var tok = tokens[i];

      var resolvedCode = null;
      var resolvedIsAlias = false;
      if (codeSet) {
        if (codeSet.indexOf(tok) !== -1) resolvedCode = tok;
        else {
          var aliasCandidate = longCodeToShortCandidate(tok);
          if (aliasCandidate && codeSet.indexOf(aliasCandidate) !== -1) { resolvedCode = aliasCandidate; resolvedIsAlias = true; }
        }
      } else if (SHORT_CODE_RE.test(tok) || LONG_CODE_RE.test(tok)) {
        resolvedCode = tok;
      }
      if (resolvedCode) {
        var isShareable = !resolvedIsAlias && codeSet && directOccurCount[resolvedCode] === 1;
        if (currentCodes.length && !groupHasRows && isShareable && groupIsShareable) { currentCodes.push(resolvedCode); }
        else { currentCodes = [resolvedCode]; groupHasRows = false; }
        groupIsShareable = isShareable;
        currentDong = ''; currentFloorRaw = null; lastDongIdx = -1; i++; continue;
      }

      if (isDongToken(tok) || (lastDongIdx === i - 1 && isDongContinuationToken(tok))) {
        currentDong = (lastDongIdx === i - 1) ? (currentDong + ' ' + tok) : tok;
        lastDongIdx = i;
        i++; continue;
      }

      // "1층 (동/호 목록1) 4 ... / (동/호 목록2) 10 ..."처럼 같은 층에 동/호 그룹만 다르고
      // 층 표기 자체는 반복되지 않는 두 번째 이후 행이 있다(실사례: 북수원이목지구 대방
      // 디에트르 더 리체Ⅱ(A3BL) - 동/호 목록이 페이지 경계를 넘어가며 재구성 순서가 흐트러져
      // 세대수 숫자 "10"만 덩그러니 남는다). 이런 순수 숫자 하나는 "새 층 목록"의 시작으로도
      // 보일 수 있어(아래 isFloorToken 분기의 순수숫자 폴백) 형태만으로는 구분이 안 되지만,
      // "바로 직전 토큰이 동/호 목록의 일부였다"는 문맥 신호가 있으면 그 동/호 그룹의
      // 세대수일 가능성이 훨씬 높다. 이 토큰 자체를 세대수로 삼아 바로 뒤에 colMap 개수만큼
      // 금액이 오는지 먼저 시도해보고, 성공하면 직전 층을 그대로 이어받는다.
      if (/^\d+$/.test(tok) && currentCodes.length && currentFloorRaw != null && lastDongIdx === i - 1) {
        var rCont = readMoneyRun(tokens, i, colMap, unit_mult);
        if (rCont) {
          pushRow(currentFloorRaw, rCont);
          i = rCont.nextIndex;
          continue;
        }
      }

      // 층별 세대수 분해 없이, 코드 뒤에 타입 전체 세대수 숫자 하나만 있고 그 뒤로 "최저가"/
      // "최고가" 두 행만 이어지는 표가 있다(실사례: 목동윤슬자이 오피스텔 - "1군 115A 118" 다음
      // "최저가 ..." "최고가 ..." 두 행뿐, 층별 행 자체가 없음). 이 118을 아래 isFloorToken
      // 분기가 "층" 표기로 오인해 소비하면 최저가/최고가 두 행이 세대수 없는 라벨행으로 처리돼
      // pushRow의 fallback(세대수=1)이 적용되고, 타입당 세대수가 2로 왜곡된다. 최저가/최고가
      // 사이의 실제 세대수는 문서에 층별로 나와 있지 않으므로, 통상 저층부(최저가)/고층부
      // (최고가)로 반반 나뉜다고 보고 전체 세대수를 절반씩 배정한다(사용자 확인: 이 업계
      // 관행대로 반반 분배 후 가중평균하는 게 맞는 처리). 홀수면 나머지 1세대는 최고가 쪽에
      // 붙여 합계가 정확히 전체 세대수가 되게 한다. 각 행은 자기 실제 가격(평균이 아님)을
      // 그대로 쓰고, 소계/평균 행은 기존처럼 세대수 가중평균(SUMPRODUCT)으로 계산되므로
      // 결과적으로 두 가격의 세대수 가중평균이 반영된다.
      if (/^\d+$/.test(tok) && currentCodes.length && !groupHasRows && tokens[i + 1] === '최저가') {
        var typeUnits = Number(tok);
        var lowRun = readMoneyRun(tokens, i + 1, colMap, unit_mult);
        if (lowRun && lowRun.label === '최저가' && tokens[lowRun.nextIndex] === '최고가') {
          var highRun = readMoneyRun(tokens, lowRun.nextIndex, colMap, unit_mult);
          if (highRun && highRun.label === '최고가') {
            var lowUnits = Math.floor(typeUnits / 2);
            var highUnits = typeUnits - lowUnits;
            currentCodes.forEach(function (code) {
              rows.push({
                code: code,
                floor: parseFloorDesc('최저가'),
                dong: currentDong,
                units: lowUnits,
                price: lowRun.values.total,
                down_payment: lowRun.values.down != null ? lowRun.values.down : null,
                down_is_ratio: false,
                down_ratio: null,
                land: lowRun.values.land,
                build: lowRun.values.build,
                vat: lowRun.values.vat,
                balance: lowRun.values.balance,
                mid_amounts: lowRun.values.mid
              });
              rows.push({
                code: code,
                floor: parseFloorDesc('최고가'),
                dong: currentDong,
                units: highUnits,
                price: highRun.values.total,
                down_payment: highRun.values.down != null ? highRun.values.down : null,
                down_is_ratio: false,
                down_ratio: null,
                land: highRun.values.land,
                build: highRun.values.build,
                vat: highRun.values.vat,
                balance: highRun.values.balance,
                mid_amounts: highRun.values.mid
              });
            });
            groupHasRows = true;
            i = highRun.nextIndex;
            continue;
          }
        }
      }

      if (isFloorToken(tok) && currentCodes.length) {
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
      if (isLabelToken(tok) && currentCodes.length && currentFloorRaw != null) {
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
          if (codeSet.indexOf(p) !== -1) { codesHere.push(p); return; }
          // "84B,D"처럼 같은 숫자 접두부를 공유하는 코드를 나열할 때 뒤쪽 코드의 숫자
          // 접두부를 생략하는 표기(실사례: 오산헤리티지자이 1단지 "84B,D") 대응: 바로
          // 앞에서 매치된 코드의 숫자 접두부를 이 조각 앞에 붙여서도 확인해본다.
          var lastMatched = codesHere.length ? codesHere[codesHere.length - 1] : null;
          var prefixMatch = lastMatched && lastMatched.match(/^\d+/);
          if (prefixMatch) {
            var combined = prefixMatch[0] + p;
            if (codeSet.indexOf(combined) !== -1) codesHere.push(combined);
          }
        });
      } else if (SHORT_CODE_RE.test(tok) || LONG_CODE_RE.test(tok)) {
        codesHere = [tok];
      }

      if (codesHere.length) {
        // 표가 페이지 경계를 넘어가며 "타입 항목 위치 품목명 옵션금액 비고사항" 헤더 행이
        // 다시 인쇄되고 그 바로 뒤에 코드가 한 번 더 나오는 문서가 있다(실사례: 북수원이목지구
        // 대방 디에트르 더 리체Ⅱ(A3BL) - "84B" 카탈로그가 페이지 경계에서 끊기고 다음 페이지에
        // "84BP"가 헤더 재인쇄 직후 다시 나온다). 이건 새 타입으로의 전환이 아니라 직전
        // 카탈로그가 페이지를 넘어 계속된다는 신호이므로("비고사항"/"비고"로 끝나는 표 헤더
        // 직후라는 형태적 특징으로 판별), 새 그룹을 시작하는 대신 직전 그룹의 코드 목록에
        // 추가해 이후 항목들이 두 코드 모두에 반영되게 한다.
        var isHeaderRepeatCode = groups.length && /^(비고사항|비고)$/.test(tokens[i - 1] || '') &&
          codesHere.every(function (c) { return groups[groups.length - 1].codes.indexOf(c) === -1; });
        if (current && current.startedByCode && current.firstMoney === null) {
          current.codes = current.codes.concat(codesHere);
        } else if (isHeaderRepeatCode) {
          groups[groups.length - 1].codes = groups[groups.length - 1].codes.concat(codesHere);
          current = groups[groups.length - 1];
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

  // "구분 84A 84B ... 비고"처럼 헤더 행 자체에 타입 코드가 여러 개 나열되는 표는, 품목(행)마다
  // 타입별 금액이 열로 나열되는 카탈로그형(다항목·타입별 열거) 구조다(실사례: 의왕역 SK VIEW
  // "평면 특화"/"공간 특화"/"마감 특화" 표 - "구분 45 59A 59B 84A 84A(수납강화형 주방) 84B 84C
  // 비고" 헤더 아래 "①스마트 언박싱 현관 2,100,000 1,800,000 -"처럼 한 품목이 타입마다 다른
  // 금액을 갖는다). "코드 하나에 값 하나(또는 순서대로 이어지는 몇 개의 안)"라는
  // scanAmountGroups의 전제와 근본적으로 다른 표라 이 방식으로는 신뢰성 있게 해석할 수 없고,
  // 잘못 해석하면 같은 옵션 섹션 안의 다른 정상 표(코드별로 한 줄씩 나오는 표) 결과까지
  // 오염시킨다(실측: 모든 타입이 표 안 어딘가의 최솟값 하나로 뭉개짐). "구분"으로 시작해 근처에
  // codeSet 멤버가 2개 이상 나오고 "비고"로 끝나는 헤더가 나오면, 그 블록은(다음 "■"/"▣" 헤딩
  // 또는 다음 "구분...비고" 헤더 직전까지) 통째로 스캔 대상에서 제외한다 - 그 블록만큼은
  // 옵션가를 인식하지 못하고 명시적으로 비워두는 것이, 다른 정상 표까지 끌고 들어가 엉뚱한
  // 금액을 만드는 것보다 안전하다.
  // 카탈로그형 표 블록의 끝은 findNextHeadingBoundary(다음 "■" 하나)로 단순히 정하면 안 된다
  // - 이 표들은 내부에 "■공간특화 ②미니멀 주방 동시선택 불가"처럼 다른 품목을 참조하는
  // 각주성 인라인 불릿을 흔히 포함하고, 품목 카테고리(평면특화/공간특화/마감특화/가전시스템
  // 특화 등)마다 또 자기 이름의 "■" 헤딩을 갖기 때문에 첫 인라인 불릿에서 멈추면 표의
  // 극히 일부만 걷어내고 나머지는 그대로 남긴다. 실제 표가 다 끝나는 지점은 예외 없이
  // "납부일정/납부계좌/유의사항"류 안내 헤딩이므로, findSectionEndHeading과 같은 기준으로
  // (그 사이의 다른 모든 "■"는 카탈로그 항목 전환이든 각주 참조든 건너뛰고) 찾는다.
  // 카탈로그형 헤더는 "구분 84A 84B 비고"처럼 "비고"로 끝나는 경우도 있지만, "구분(약식표기)
  // 75 84A 84B 84C 102 124 166P"처럼 "비고" 없이 코드 나열로 그냥 끝나는 경우도 있다(실사례:
  // 오산헤리티지자이 1/2단지 발코니 확장 표 - "구분" 한 줄 안에 타입 코드가 열 헤더로 전부
  // 나열되고, 그 아래 "발코니 확장 금액/계약금/중도금/잔금" 각 행이 코드별 값을 옆으로
  // 나열한다). "비고"라는 특정 단어보다, "구분으로 시작하는 한 줄 안에 codeSet 멤버가 2개
  // 이상 등장하는지"라는 형태적 특징만으로 판별한다.
  function stripCatalogTables(text, codeSet) {
    if (!codeSet || !codeSet.length) return text;
    // PDF 추출 과정에서 "구분"의 두 글자 사이에 공백이 끼는 경우가 있다(실사례: 봉선동 르
    // 오네뜨 2차 "구 분 유상옵션 품목 공급금액 비고" - 이 문서의 다른 헤더에도 "계 약 금"/
    // "중 도 금"처럼 같은 종류의 글자 사이 공백 오염이 있었다). 공백 유무와 무관하게 인식한다.
    var HEADER_LINE_RE = /^[ \t]*구\s?분[^\n]*/gm;
    var cuts = [];
    var m;
    while ((m = HEADER_LINE_RE.exec(text))) {
      var headerStart = m.index;
      var hit = codeSet.filter(function (c) { return m[0].indexOf(c) !== -1; });
      if (hit.length < 2) continue;
      var blockEnd = findSectionEndHeading(text, headerStart);
      if (blockEnd < 0) blockEnd = text.length;
      cuts.push({ start: headerStart, end: blockEnd });
      HEADER_LINE_RE.lastIndex = blockEnd;
    }
    if (!cuts.length) return text;
    var result = text;
    cuts.sort(function (a, b) { return b.start - a.start; });
    cuts.forEach(function (c) { result = result.slice(0, c.start) + '\n' + result.slice(c.end); });
    return result;
  }

  // "1) 시스템에어컨 ... 2) 가전 ... 3) 인테리어/기타 ..."처럼 항목 대분류가 번호 매김
  // 소제목으로 나뉘는 문서가 있다(실사례: 춘천 리버뷰 아이파크). 각 소제목마다 완전히
  // 다른 품목(에어컨/냉장고/오븐/욕실/조명 등)의 가격이 나오는데, "코드당 최솟값 하나"라는
  // scanAmountGroups의 전제로는 이 여러 품목을 구분할 수 없어 전혀 다른 품목의 최저가가
  // 섞여 나온다(실측: 84A 옵션가로 "시스템에어컨" 대신 "오븐" 최저가가 잡힘). 어느 품목이
  // "그" 옵션가인지 판단할 근거가 없으므로, 발코니 확장비처럼 이미 하나의 표로 정리된
  // 문서와 달리 첫 번째 소제목(보통 시스템에어컨 등 대표 품목)만 남기고 나머지는 통째로
  // 포기한다 - 여러 품목의 최저가가 뒤섞인 값보다는, 첫 품목만 정확히 반영하는 쪽이 안전하다.
  function restrictToFirstNumberedSubsection(text) {
    var re = /^\d\)\s*\S/gm;
    var idx = [];
    var m;
    while ((m = re.exec(text))) idx.push(m.index);
    if (idx.length < 2) return text;
    return text.slice(0, idx[1]);
  }

  // "N) 제목"처럼 번호가 없어도, "천장형 시스템에어컨 ... (단위 : 원, 부가가치세 포함)" /
  // "시스템 공기청정기 ... (단위 : 원, 부가가치세 포함)" / "주방가전 옵션 ... (단위 : 원,
  // 부가가치세 포함)"처럼 품목 대분류 제목이 전부 "(단위 : ...)" 표기로 끝나는 줄로 구분되는
  // 문서도 있다(실사례: 오산헤리티지자이 1/2단지 "12 유상옵션" 아래 천장형 시스템에어컨/
  // 시스템 공기청정기/주방가전 옵션). restrictToFirstNumberedSubsection과 같은 이유로, 이런
  // 줄이 2개 이상 나오면 첫 품목만 남기고 나머지는 포기한다.
  // 괄호가 아니라 대괄호로 "[단위 : 원, VAT 포함]"이라 쓰는 문서도 있다(실사례: 봉선동 르
  // 오네뜨 2차 - "① 천장형 시스템에어컨 [단위 : 원, VAT 포함]" / "1. 르 오네뜨 시그니처
  // 패키지 [단위 : 원, VAT 포함]" / "2. 개별 선택옵션 [단위 : 원, VAT 포함]" 세 소제목이 전부
  // 대괄호형이었는데, 괄호만 인식하는 바람에 두 번째 소제목에서 끊지 못해 뒤이은 "개별
  // 선택옵션"(코드 없이 품목만 나열되는 별개의 카탈로그) 표의 무관한 금액이 코드에 잘못
  // 붙었다). 괄호/대괄호 모두 같은 역할의 구분 표기이므로 둘 다 인정한다.
  function restrictToFirstUnitMarkerSubsection(text) {
    var re = /^.{0,80}[(（[]\s*단위\s*[:：][^)）\]]*[)）\]]\s*$/gm;
    var idx = [];
    var m;
    while ((m = re.exec(text))) idx.push(m.index);
    if (idx.length < 2) return text;
    return text.slice(0, idx[1]);
  }

  // "항 목 타입 품목명 옵션금액 계약금 잔금 비 고"처럼 "타입"이 코드 나열이 아니라 컬럼
  // 이름으로만 쓰이고, 실제 데이터 행은 품목(냉장고/오븐/세탁기 하부장 등)마다 "전 주택형"
  // 같은 코드 아닌 값을 갖는 별개의 카탈로그 표가 뒤이어 나오는 문서가 있다(실사례: 송도국제
  // 도시 B1블록 대방디엠시티 오피스텔 - 타입별 시스템에어컨 표 바로 뒤에, 코드 반복 없이
  // "전 주택형" 공통 품목만 나열되는 가전/가구 카탈로그가 헤더 구분 없이 곧장 이어짐). 이런
  // 표가 scanAmountGroups의 범위에 섞이면, "코드가 마지막으로 등장한 뒤 나오는 순수 한글
  // 단어는 그 코드의 연속행"이라는 규칙이 이 무관한 카탈로그의 한글 단어에도 적용되어(예:
  // "세탁기 하부장 300,000") 엉뚱한 금액이 직전 코드의 옵션가로 잘못 채택된다(실측: 84OB의
  // 옵션가가 자기 표의 2,000,000 대신 이 카탈로그의 300,000으로 뭉개짐). "타입"과 "품목명"이
  // 나란히 컬럼 헤더로 나오는 줄이 보이면 그 지점부터는 코드당 값 하나라는 전제와 안 맞는
  // 별개의 표이므로, 그 이전까지만 남긴다(restrictToFirstNumberedSubsection과 같은 이유로
  // 첫 번째 진짜 코드별 표만 신뢰하고 나머지는 명시적으로 포기).
  function restrictBeforeItemCatalogHeader(text) {
    var m = text.match(/^[ \t]*항\s?목[ \t]+타입[ \t]+품목명/m);
    if (!m || m.index == null) return text;
    return text.slice(0, m.index);
  }

  // stripCatalogTables가 걷어낸 카탈로그형 표가, 실제로는 코드마다 값 하나씩만 있는 단순한
  // 열-정렬 표일 수도 있다(실사례: 오산헤리티지자이 1/2단지 발코니 확장비 - "구분(약식표기)
  // 75 84A 84B 84C 102 124 166P" 헤더 한 줄 다음에 "발코니 확장 금액 17,700,000 19,900,000
  // ..."처럼 헤더의 코드 순서 그대로 금액이 나열된다). 이런 경우 헤더 줄의 코드 등장 순서와
  // 그 직후 데이터 줄의 금액 개수가 정확히 일치하는지(=산술적으로 1:1 대응이 명백한지)를
  // 검증해, 맞을 때만 코드별 값으로 복구한다. 옵션처럼 여러 품목이 뒤섞인 카탈로그(우열을
  // 가릴 수 없는 다항목 표)에서는 이 복구를 시도하지 않는다 - 발코니 확장비처럼 "그 표가
  // 이 섹션의 유일한 내용"일 때만(=다른 정상 경로로 이미 값을 찾은 코드가 하나도 없을 때만)
  // 폴백으로 사용한다.
  function extractColumnAlignedCandidates(text, codeSet) {
    if (!codeSet || !codeSet.length) return {};
    var lines = text.split(/\n/);
    var out = {};
    for (var i = 0; i < lines.length; i++) {
      var headerLine = lines[i].trim();
      if (!/^구\s?분/.test(headerLine)) continue;
      var headerCodes = [];
      headerLine.split(/\s+/).forEach(function (p) { if (codeSet.indexOf(p) !== -1) headerCodes.push(p); });
      if (headerCodes.length < 2) continue;
      for (var j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        var dtoks = lines[j].trim().split(/\s+/).filter(Boolean);
        var moneyToks = dtoks.filter(isMoneyToken);
        if (moneyToks.length === headerCodes.length) {
          headerCodes.forEach(function (c, idx) {
            out[c] = (out[c] || []).concat([toNum(moneyToks[idx])]);
          });
          break;
        }
      }
    }
    return out;
  }

  function parseAmountByCodeSection(text, codes) {
    text = fixGluedNumbers(despaceKeywords(String(text || '')));
    text = restrictToFirstNumberedSubsection(text);
    text = restrictToFirstUnitMarkerSubsection(text);
    text = restrictBeforeItemCatalogHeader(text);
    var unit_mult = detectUnitMult(headerText(text));
    var codeSet = codes && codes.length ? codes.slice() : null;
    var strippedText = stripCatalogTables(text, codeSet);
    var tokens = strippedText.split(/\s+/).filter(Boolean);
    var groups = scanAmountGroups(tokens, codeSet);

    var candidates = {};
    groups.forEach(function (g) {
      if (g.firstMoney == null) return;
      g.codes.forEach(function (c) {
        candidates[c] = (candidates[c] || []).concat([g.firstMoney]);
      });
    });

    if (!Object.keys(candidates).length) {
      var columnCandidates = extractColumnAlignedCandidates(text, codeSet);
      Object.keys(columnCandidates).forEach(function (c) {
        candidates[c] = (candidates[c] || []).concat(columnCandidates[c]);
      });
    }

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

    // "공고일:" 처럼 곧바로 값이 오는 경우뿐 아니라 "공고일은 2026.07.10.입니다"처럼 한글
    // 조사(은/는/이/가)가 라벨과 값 사이에 끼는 서술형 문장도 지원한다(실사례: 부산 장안지구
    // B-2블록 - "본청약 입주자모집공고일은 2026.07.10.입니다.").
    var openM = text.match(/(?:입주자\s*모집\s*)?공고일\s*(?:은|는|이|가)?\s*[:：]?\s*([0-9.\-/년월일\s]{6,20})/);
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

  // 대부분의 실사례는 "■"/"▣" 불릿 뒤에 섹션 제목이 오지만, 대분류 번호("3 공급내역 및
  // 공급금액")만 붙고 그 하위의 "공급대상 및 면적"/"공급대금 및 납부일정" 제목 자체에는
  // 불릿이 전혀 없는 문서도 있다(실사례: 오산헤리티지자이 1/2단지). 이런 경우까지 대응하기
  // 위해 불릿 없이 줄 시작(^)에서 바로 매칭하는 패턴을 함께 둔다 - 문구가 아주 구체적이라
  // (표 제목 전체 문구) 본문 산문 중간에서 우연히 줄 시작과 일치할 위험은 낮다.
  var SECTION_ANCHORS = {
    // "공급대상" 대신 "공급면적"으로 쓰는 문서도 있다(실사례: 목동윤슬자이 오피스텔 -
    // "■ 공급면적 및 공급규모", "▣ 공급면적"). 표 안 열 이름·본문 산문에도 "공급면적"이
    // 그냥 단어로 등장하지만(예: "전용면적, 공급면적 및 계약면적의...") ■/▣ 기호가 바로
    // 앞에 붙는 진짜 제목줄만 앵커로 삼으므로 잘못 걸리지 않는다.
    area: [/[■▣]\s*공급대상\s*(?:및\s*공급규모)?(?!물)/, /^\s*공급대상\s*및\s*면적/m, /[■▣]\s*공급면적\s*(?:및\s*공급규모)?/],
    // "■ 공급금액 표"처럼 짧게 줄여 쓰는 문서도 있다(실사례: 북수원이목지구 대방 디에트르
    // 더 리체Ⅰ(A4BL) - 다른 문서들의 "및 납부일정"/"납부조건 등 안내" 대신 그냥 "표"만 붙음).
    // "납부일정"의 두 글자 사이에 공백이 낀 "납부 일정"도 있다(실사례: 목동윤슬자이
    // 오피스텔 - "■ 공급금액 및 납부 일정" - PDF 추출 시 한글 단어 중간에 공백이 끼는,
    // 이미 여러 차례 확인된 문제와 같은 종류).
    price: [/[■▣]\s*공급금액\s*및\s*납부\s*일정/, /[■▣]\s*분양가격\s*납부조건\s*등?\s*안내/, /[■▣]\s*공급금액\s*납부조건\s*등?\s*안내/, /[■▣]\s*공급금액\s*표(?![가-힣])/, /^\s*공급대금\s*및\s*납부일정/m],
    balcony: [/[■▣]\s*발코니\s*확장/],
    // "추가"로 시작해 "옵션품목"으로 끝나는 헤딩은 문서마다 그 사이에 들어가는 말이
    // 제각각이다(추가 선택 옵션품목/추가선택 옵션품목/추가선택사항 옵션품목 등 - 실사례:
    // 부산에코델타시티 디에트르 더 퍼스트는 "추가선택사항 옵션품목"이라 "사항"이 끼어
    // 있어 기존의 키워드 나열식 패턴 어디에도 걸리지 않았다). 키워드를 하나씩 추가하는
    // 대신 "■/▣ 바로 뒤 추가 + (순수 한글/공백 몇 글자) + 옵션품목" 형태 자체를 앵커로
    // 삼아 일반화한다 - 사이 구간을 순수 한글/공백 6자 이내로 제한해 본문 산문 속
    // 우연한 재언급(예: "▣ 시스템 에어컨 및 추가선택사항 옵션품목"은 ■/▣ 바로 뒤가
    // "추가"가 아니라 "시스템"이라 애초에 매칭되지 않는다)까지 잘못 앵커로 삼는 일은 없다.
    option: [/[■▣]\s*추가[\s가-힣]{0,6}옵션품목/, /[■▣]\s*옵션품목/, /[■▣]\s*별도계약\s*[-–]\s*추가\s*선택품목/, /[■▣]\s*추가\s*선택품목/]
  };
  var NEXT_MAJOR_SECTION_RE = /청약신청\s*자격\s*및\s*공급일정/;

  // pdf.js 텍스트 재구성 순서가 시각적 순서와 어긋나는 문서(예: 더샵 송도그란테르 G5-3블록)에서는,
  // "▣ 공급대상" 제목 바로 뒤에 표 본문이 오지 않고 "▣ 공급금액 및 납부일정" 제목 뒤로 표 본문
  // 전체가 밀려나 있는 경우가 있다. 이 경우 앵커 기반 1차 분리만으로는 area 섹션이 안내문 몇
  // 줄만 남고 실제 표는 price 섹션 앞부분에 섞여 들어간다. 다행히 각 표 바로 앞에는 "(단위 :
  // ㎡...)"(면적표)/"(단위 : 원...)"(가격표) 표기가 항상 붙어 있으므로, 이 둘을 2차 경계로 삼아
  // 재분리할 수 있다. area 섹션이 실제로 비어 있을 때만(정상 케이스는 건드리지 않도록) 시도하고,
  // 복구한 조각이 실제로 유효한 면적 행을 만들어낼 때만 채택한다(실패하면 조용히 포기 - 앞서
  // "합쳐서 재시도" 폴백을 폐기한 것과 같은 원칙: 명시적 실패가 조용한 오염보다 안전하다).
  var AREA_UNIT_MARKER_RE = /[(（]\s*단위[^)）]*㎡[^)）]*[)）]/;
  var PRICE_UNIT_MARKER_RE = /[(（]\s*단위[^)）]*원[^)）]*[)）]/;

  function repairMisplacedAreaTable(area, price) {
    if (parseAreaSection(area).length > 0) return null;
    var areaMarkerIdx = price.search(AREA_UNIT_MARKER_RE);
    if (areaMarkerIdx < 0) return null;
    var priceMarkerMatch = price.slice(areaMarkerIdx + 1).match(PRICE_UNIT_MARKER_RE);
    if (!priceMarkerMatch) return null;
    var priceMarkerIdx = areaMarkerIdx + 1 + priceMarkerMatch.index;
    var recoveredArea = price.slice(areaMarkerIdx, priceMarkerIdx).trim();
    var recoveredPrice = price.slice(priceMarkerIdx).trim();
    if (!parseAreaSection(recoveredArea).length) return null;
    return { area: (area + '\n' + recoveredArea).trim(), price: recoveredPrice };
  }

  // "최상층\n(107동 2,3호,\n108동 1,2호)\n4 652,540,196 ..."처럼 층 표기와 그 세대수 숫자
  // 사이에 괄호로 묶인 동/호 설명이 여러 줄로 줄바꿈되어 끼는 행이 있다(실사례: 북수원이목지구
  // 대방 디에트르 더 리체Ⅰ(A4BL)). 줄 단위로 RESUME_RE를 검사하면 "최상층"만 있는 줄에는
  // 세대수 숫자가 없고, 세대수 숫자가 있는 줄에는 "층" 표기가 없어 어느 줄도 매칭되지 않는다.
  // "층 표기로 시작하지만 같은 줄에 세대수 숫자가 없는" 줄을 만나면, 세대수 숫자가 나올
  // 때까지(최대 4줄) 뒤이은 줄들을 이어붙여 하나의 논리적 행으로 합친 뒤에 매칭을 시도한다
  // (괄호 안 문구가 무엇이든 상관없는 형태적 규칙 - 무관한 프로즈까지 잘못 삼키지 않도록
  // 이어붙이는 줄 수에 상한을 둔다).
  function mergeWrappedFloorLines(lines, resumeRe) {
    var floorStartRe = /^[ \t]*(\d+(?:~\d+)?[ \t]*층|기준층|최상층|최하층)/;
    // 괄호 안 내용(동/호 부연설명 등)은 지우고 판단해야 한다 - "괄호 안 동/호 번호"가
    // 아니라 "괄호 밖 진짜 세대수"에 매칭된 것임을 보장하기 위해서다. 실제 데이터가
    // "14층\n(최상)\n1 338,283,000..."처럼 층 표기와 숫자 사이에 괄호 부연설명이 끼어
    // 있으면, 괄호를 지우기 전(원문 그대로)에는 "층" 바로 뒤가 공백이 아니라 "("라 영원히
    // 매칭될 수 없다(실사례: 진월동지역주택조합 - 이 때문에 재개 지점을 못 찾고 그 다음
    // 줄로 건너뛰어 그 사이 코드 헤더까지 통째로 유실됐다). 괄호를 지운 뒤의 매칭만으로
    // 판단하면 충분하다 - 그 안의 숫자는 지워지고 없으니 "괄호 안 번호에 우연히 매칭"될
    // 여지 자체가 없다.
    function matchesResume(s) {
      return resumeRe.test(s.replace(/\([^()]*\)/g, ' '));
    }
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (floorStartRe.test(line) && !matchesResume(line)) {
        var merged = line;
        // 괄호가 아직 안 닫혔으면(또는 괄호 밖에 아직 진짜 세대수가 안 나왔으면) 계속 이어붙인다.
        var openCount = (line.match(/\(/g) || []).length;
        var closeCount = (line.match(/\)/g) || []).length;
        var j = i + 1;
        var limit = Math.min(lines.length, i + 5);
        while (j < limit && (openCount > closeCount || !matchesResume(merged))) {
          merged += ' ' + lines[j];
          openCount += (lines[j].match(/\(/g) || []).length;
          closeCount += (lines[j].match(/\)/g) || []).length;
          j++;
        }
        if (openCount <= closeCount && matchesResume(merged)) { out.push(merged); i = j; continue; }
      }
      out.push(line);
      i++;
    }
    return out;
  }

  // 표가 페이지 경계를 넘어가며 pdf.js 재구성 순서상 중간에 안내문(유의사항/청약일정 등)이
  // 여러 개 끼어들어, 뒤쪽 절반의 행(주로 다음 페이지로 넘어간 나머지 주택형들)이 "■ 공급금액
  // 및 납부일정" 제목보다도 뒤로 밀려나는 문서가 있다(실사례: 부산에코델타시티 디에트르 더
  // 퍼스트(28BL) - 공급대상 표가 84A/84B 두 행만 area 섹션에 남고, 84C/110A/110B/110C 네 행은
  // price 섹션 앞부분(가격표 제목보다도 앞)에 끼어 들어간다). repairMisplacedAreaTable은 area가
  // "통째로 비어 있을 때"만 동작하므로 이런 "일부만 누락"에는 대응하지 못한다. 헤더 키워드가
  // 아니라 "행 번호 + 긴 코드(NNN.NNNN + 문자)로 시작하는 행"이라는 공급대상 표 행 특유의
  // 구조를 앵커로 삼아 price 섹션 텍스트 안에서 찾아 이어붙인다. 실제로 새 코드를 더 찾아낼
  // 때만 채택한다(명시적 실패가 조용한 오염보다 안전하다는 원칙 유지).
  var AREA_ROW_RESUME_RE = /^[ \t]*\d{1,2}[ \t]+\d{2,3}\.\d{2,4}[A-Za-z]{1,2}[ \t]+\S+[ \t]+\d/;
  // 이어붙인 마지막 데이터 행 바로 뒤에 "합계" 총계 행이 붙어 있는 경우, 그 행도 함께
  // 옮겨야 마지막 코드(예: 110C)의 세그먼트가 총계 행에서 정상적으로 끊긴다(안 그러면
  // 그 뒤 유의사항 산문·매핑 표까지 세그먼트가 삼켜 세대수가 오염된다).
  var AREA_TOTAL_ROW_RE = /^[ \t]*합\s*계[ \t]+\d/;
  function repairFragmentedAreaTable(area, price) {
    var before = parseAreaSection(area);
    // area가 통째로 비어 있는 경우(전체 누락)는 보통 repairMisplacedAreaTable이 "(단위 : ㎡...)"
    // 표기를 앞세워 먼저 처리하지만, 그 표기 자체가 없는 문서도 있다(실사례: 북수원이목지구
    // 대방 디에트르 더 리체Ⅰ(A4BL) - "■ 공급대상" 제목 뒤에는 유의사항 산문만 있고 실제
    // 데이터 행은 "(단위: ㎡...)" 표기 없이 price 섹션 쪽(가격표 제목보다도 앞)에 있다). 아래
    // 로직은 before.length가 0이어도 그대로 동작하므로(찾아낸 행이 있으면 무조건 개선) 굳이
    // 따로 분기하지 않고 이 함수 하나로 부분/전체 누락을 모두 처리한다.
    var lines = String(price || '').split('\n');
    var extraLines = [];
    var restLines = [];
    var lastMatchIdx = -1;
    lines.forEach(function (line, idx) {
      if (AREA_ROW_RESUME_RE.test(line)) { extraLines.push(line); lastMatchIdx = idx; }
      else restLines.push(line);
    });
    if (!extraLines.length) return null;
    // 마지막으로 옮긴 데이터 행 바로 다음 줄이 총계 행이면 함께 옮긴다.
    if (lastMatchIdx >= 0 && lastMatchIdx + 1 < lines.length && AREA_TOTAL_ROW_RE.test(lines[lastMatchIdx + 1])) {
      extraLines.push(lines[lastMatchIdx + 1]);
      var totalLineIdx = restLines.indexOf(lines[lastMatchIdx + 1]);
      if (totalLineIdx !== -1) restLines.splice(totalLineIdx, 1);
    }
    // 되찾은 행을 area 텍스트 맨 끝(유의사항 산문·"주택형 표시 안내" 매핑 표 등을 다 지난
    // 뒤)에 붙이면, 원래 있던 마지막 실제 데이터 행(예: 84B)의 세그먼트가 다음 경계를 만나지
    // 못하고 그 산문·매핑 표 전체를 삼켜버려 세대수 등이 엉뚱한 값으로 오염된다(실사례로 확인).
    // 표가 원래 있어야 할 자리, 즉 마지막 데이터 행 바로 뒤(그 다음에 오는 "■/▣" 안내문
    // 제목 직전)에 끼워 넣어야 세그먼트 경계가 정상적으로 이어진다.
    var insertAt = findNextHeadingBoundary(area, 0);
    var merged = insertAt > 0
      ? (area.slice(0, insertAt).replace(/\s+$/, '') + '\n' + extraLines.join('\n') + '\n' + area.slice(insertAt)).trim()
      : (area + '\n' + extraLines.join('\n')).trim();
    var after = parseAreaSection(merged);
    var beforeCodes = {};
    before.forEach(function (a) { beforeCodes[a.code] = true; });
    var gained = after.filter(function (a) { return !beforeCodes[a.code]; }).length;
    if (!gained || after.length <= before.length) return null; // 개선이 없으면 조용히 포기
    return { area: merged, price: restLines.join('\n').trim() };
  }

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

  function computeSectionEnd(text, start, endCandidates) {
    var end = text.length;
    for (var i = 0; i < endCandidates.length; i++) {
      var c = endCandidates[i];
      if (c >= 0 && c > start && c < end) end = c;
    }
    return end;
  }

  function sliceSection(text, start, endCandidates) {
    if (start < 0) return '';
    var end = computeSectionEnd(text, start, endCandidates);
    return text.slice(start, end).trim();
  }

  // 표 중간에 페이지 여백의 사이드 노트(예: "■ 공통사항" 안내문)가 pdf.js 재구성 순서상
  // 끼어들어, 같은 표의 뒷부분(일부 타입의 행)이 그 안내문 뒤로 밀려나는 문서가 있다
  // (실사례: 부산 장안지구 B-2블록 중흥S-클래스 - 59B 후반부/84A/84B 행이 "■ 공통사항"
  // 뒤로 밀림). 헤더 문구가 아니라 "area 섹션에서 이미 확인된 타입 코드 중 price 섹션에
  // 하나도 안 잡힌 코드가 있는지"(=표가 잘렸는지)로 판단하고, 있다면 그 코드가 실제로
  // 다시 등장하는 뒷부분을 찾아 이어붙인다. 이어붙인 결과가 실제로 그 코드를 더 찾아내는
  // 경우에만(=parsePriceSection 자체로 개선 여부를 검증) 채택한다 - 실패하면 조용히
  // 포기하고 원래(더 짧은) price를 그대로 둔다.
  // boundIdx: 이 경계(다음 진짜 섹션의 시작 등)를 넘어서까지 이어붙이지 않는다 - 그렇지
  // 않으면 "이 섹션엔 원래 없는 코드"(예: 발코니 확장 대상에서 제외된 타입)를 뒤이어 오는
  // 완전히 다른 섹션(옵션 등)에서 잘못 주워오게 된다(실사례로 확인: 의왕역 SK VIEW -
  // 발코니 확장 대상에서 제외된 "36" 타입을 찾으려다 옵션 섹션의 "36" 옵션가를 발코니
  // 확장비로 오인).
  function repairFragmentedPriceTable(fullText, priceText, priceEndIdx, areaCodes, boundIdx) {
    if (!areaCodes || !areaCodes.length || priceEndIdx < 0 || priceEndIdx >= fullText.length) return null;
    var before = parsePriceSection(priceText, areaCodes).priceRows;
    var seenBefore = {};
    before.forEach(function (r) { seenBefore[r.code] = true; });
    if (areaCodes.every(function (c) { return seenBefore[c]; })) return null; // 이미 모든 코드가 있으면 손대지 않는다

    var searchEnd = (boundIdx != null && boundIdx >= 0) ? boundIdx : fullText.length;
    if (searchEnd <= priceEndIdx) return null;

    // 끊긴 지점 바로 다음이 "새 코드"로 시작한다는 보장이 없다(직전 코드의 나머지 층
    // 행일 수도 있음 - 실사례: 부산 장안지구 59B의 3/4층·기준층). 그래서 코드가 아니라
    // "표가 다시 시작되는 지점"을 층 행 패턴(층 표기 뒤에 숫자가 오는 줄 시작)으로 찾는다.
    // repairUndercountedPriceRows와 같은 패턴(층 표기와 숫자 사이에 괄호 부연설명이 끼는
    // 것도 허용 - "[^\d\n]*"는 숫자·개행만 아니면 무엇이든 통과시킨다)을 써야 한다.
    // "14층\n(최상) 1 338,283,000..."처럼 층 표기와 실제 데이터가 괄호 부연설명을 사이에
    // 두고 다른 줄로 쪼개지는 경우, mergeWrappedFloorLines로 한 줄로 합친 뒤에도 "층" 바로
    // 뒤가 공백이 아니라 "("이므로 "[ \t]+\d"처럼 공백만 허용하는 패턴은 여전히 매칭되지
    // 않는다 - 그러면 이 줄을 건너뛰고 그 다음(엉뚱하게 더 늦은) 매칭에서 재개해버려, 건너뛴
    // 줄과 그 사이에 있던 코드 헤더까지 통째로 유실된다(실사례: 진월동지역주택조합 -
    // "14층\n(최상)..."을 건너뛰고 그 다음 매칭인 "1층 2 359,530,000..."에서 재개되며, 그
    // 사이의 실제 재개 지점이었던 84D의 마지막 행과 "115 109동 1호, 2호" 코드 헤더가 통째로
    // 사라져 115가 아예 인식되지 않고 그 행들은 코드 없이 이어지다 이전 코드(84D)에 잘못
    // 흡수됐다).
    var RESUME_RE = /^[ \t]*(\d+(?:~\d+)?[ \t]*층|기준층|최상층|최하층)[^\d\n]*\d/m;
    var searchText = mergeWrappedFloorLines(fullText.slice(priceEndIdx, searchEnd).split('\n'), RESUME_RE).join('\n');
    var m = searchText.match(RESUME_RE);
    if (!m || m.index == null) return null;
    var resumeIdx = m.index;

    var resumeEnd = findNextHeadingBoundary(searchText, resumeIdx);
    if (resumeEnd < 0) resumeEnd = searchText.length;
    var continuation = searchText.slice(resumeIdx, resumeEnd).trim();
    if (!continuation) return null;

    var merged = (priceText + '\n' + continuation).trim();
    var after = parsePriceSection(merged, areaCodes).priceRows;
    if (after.length <= before.length) return null; // 개선이 없으면 포기(명시적 실패 유지)
    var seenAfter = {};
    after.forEach(function (r) { seenAfter[r.code] = true; });
    var beforeMissing = areaCodes.filter(function (c) { return !seenBefore[c]; }).length;
    var afterMissing = areaCodes.filter(function (c) { return !seenAfter[c]; }).length;
    if (afterMissing > beforeMissing) return null; // 코드 커버리지가 오히려 나빠지면 포기
    return merged;
  }

  // repairFragmentedPriceTable은 "코드가 통째로 한 건도 안 잡힌" 경우만 복구한다. 하지만
  // 코드 자체는 이미 일부 행을 찾았지만, 표가 여러 페이지에 걸쳐 있어 그 중 일부 행 뭉치만
  // "■ 공통 유의사항" 같은 긴 안내문 뒤로 밀려나 있는 문서가 있다(실사례: 부산에코델타시티
  // 디에트르 더 퍼스트(28BL) - 110C 타입의 마지막 4개 층(3~10층) 행이 안내문 산문 뒤로
  // 흩어져 있는데, 110C 자체는 이미 앞부분 행을 찾았으므로 위 함수가 손대지 않는다). "코드별
  // 행 세대수 합계가 공급대상표의 총공급세대수와 일치하는가"라는 산술 관계로 미달을 판별하고,
  // 부족한 만큼 층 행 패턴을 범위 안에서 모두 찾아 이어붙인다. 이어붙인 뒤에도 어느 코드의
  // 합계가 표기 세대수를 초과하면(엉뚱한 표의 행을 잘못 주워왔다는 신호) 조용히 포기한다.
  function repairUndercountedPriceRows(fullText, priceText, priceEndIdx, areaTypes, boundIdx) {
    if (!areaTypes || !areaTypes.length || priceEndIdx < 0 || priceEndIdx >= fullText.length) return null;
    var codes = areaTypes.map(function (a) { return a.code; });
    var unitsByCode = {};
    areaTypes.forEach(function (a) { unitsByCode[a.code] = a.supply_units; });
    var before = parsePriceSection(priceText, codes).priceRows;
    var sumBefore = {};
    before.forEach(function (r) { sumBefore[r.code] = (sumBefore[r.code] || 0) + (r.units || 0); });
    var shortCodes = codes.filter(function (c) { return isFinite(unitsByCode[c]) && (sumBefore[c] || 0) < unitsByCode[c]; });
    if (!shortCodes.length) return null;

    var searchEnd = (boundIdx != null && boundIdx >= 0) ? boundIdx : fullText.length;
    if (searchEnd <= priceEndIdx) return null;
    // "10층(최상층)"처럼 층 표기 바로 뒤에 괄호 설명이 붙고 나서야 세대수 숫자가 오는
    // 행도 있어(실사례: 위 110C의 마지막 행), 층 표기와 숫자 사이에 괄호 설명이 끼는 것도
    // 허용한다(숫자가 아닌 문자는 몇 글자든 허용 - 특정 괄호 문구를 나열하지 않는 형태적 일반화).
    // "최상층"/"최하층"은 숫자 접두부 없이 단독으로 층 구분에 쓰이는 표(실사례: 북수원이목지구
    // 대방 디에트르 더 리체Ⅰ(A4BL) - "최상층 12 ..."처럼 층수 숫자 없이 이 단어 자체가 층
    // 구분값). 본문 토크나이저(isFloorToken)는 이미 "층"이 포함되면 무엇이든 층 토큰으로
    // 인정하므로, 복구용 정규식도 같은 관대함으로 맞춘다.
    var RESUME_RE = /^[ \t]*(\d+(?:~\d+)?[ \t]*층|기준층|최상층|최하층)[^\d\n]*\d/;
    var lines = mergeWrappedFloorLines(fullText.slice(priceEndIdx, searchEnd).split('\n'), RESUME_RE);
    var extraLines = lines.filter(function (line) { return RESUME_RE.test(line); });
    if (!extraLines.length) return null;

    var merged = (priceText + '\n' + extraLines.join('\n')).trim();
    var after = parsePriceSection(merged, codes).priceRows;
    if (after.length <= before.length) return null;
    var sumAfter = {};
    after.forEach(function (r) { sumAfter[r.code] = (sumAfter[r.code] || 0) + (r.units || 0); });
    // 어느 코드든 합계가 표기 세대수를 초과하면 엉뚱한 행을 잘못 주워왔다는 신호이므로 포기한다.
    var overshoot = codes.some(function (c) { return isFinite(unitsByCode[c]) && (sumAfter[c] || 0) > unitsByCode[c]; });
    if (overshoot) return null;
    var improved = shortCodes.some(function (c) { return (sumAfter[c] || 0) > (sumBefore[c] || 0); });
    if (!improved) return null; // 개선이 없으면 조용히 포기(명시적 실패 유지)
    return merged;
  }

  // 발코니/옵션 섹션도 price와 같은 "표 제목 헤딩 바로 뒤에 사이드 노트(납부계좌 안내 등)가
  // pdf.js 재구성 순서상 끼어들고, 진짜 데이터 표는 그 뒤 긴 유의사항 산문을 지나서야
  // 나오는" 문제를 겪을 수 있다(실사례: 부산 장안지구 B-2블록 - "발코니 확장 공사비 및
  // 납부일정" 헤딩 직후 "발코니확장 납부계좌" 안내문이 먼저 나오고, 실제 타입별 금액 표는
  // 그보다 한참 뒤에 "구분 발코니 확장 공사비 계약금 중도금 잔금" 헤더로 다시 나온다).
  // area 코드 중 하나도 못 찾았을 때만(=표를 통째로 놓쳤다고 판단될 때만) 시도하고, 코드가
  // 줄 시작에서 다시 등장하는 지점을 찾아 이어붙인 뒤 실제로 더 많은 코드를 찾아낼 때만 채택한다.
  // boundIdx: repairFragmentedPriceTable과 동일한 이유로, 이 섹션에 원래 없는 코드를
  // 뒤이어 오는 다른 섹션에서 잘못 끌어오지 않도록 탐색 범위를 그 다음 진짜 섹션 시작
  // 직전까지로 제한한다.
  function repairFragmentedAmountSection(fullText, sectionText, sectionEndIdx, areaCodes, boundIdx) {
    if (!areaCodes || !areaCodes.length || sectionEndIdx < 0 || sectionEndIdx >= fullText.length) return null;
    var before = parseAmountByCodeSection(sectionText, areaCodes);
    var missing = areaCodes.filter(function (c) { return !(c in before); });
    if (!missing.length) return null; // 이미 모든 코드가 있으면 손대지 않는다

    var searchEnd = (boundIdx != null && boundIdx >= 0) ? boundIdx : fullText.length;
    if (searchEnd <= sectionEndIdx) return null;

    // 아직 못 찾은 코드가 줄 시작에서 다시 등장하는(=표가 재개되는) 첫 지점을 찾는다.
    var searchText = fullText.slice(sectionEndIdx, searchEnd);
    var resumeIdx = -1;
    missing.forEach(function (code) {
      var re = new RegExp('(^|\\n)[ \\t]*' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|\\n)');
      var m = searchText.match(re);
      if (m && m.index != null) {
        var idx = sectionEndIdx + m.index + (m[0].length - code.length);
        if (resumeIdx === -1 || idx < resumeIdx) resumeIdx = idx;
      }
    });
    if (resumeIdx < 0) return null;

    var resumeEnd = findNextHeadingBoundary(fullText, resumeIdx);
    if (resumeEnd < 0 || resumeEnd > searchEnd) resumeEnd = searchEnd;
    var continuation = fullText.slice(resumeIdx, resumeEnd).trim();
    if (!continuation) return null;

    var merged = (sectionText + '\n' + continuation).trim();
    var after = parseAmountByCodeSection(merged, areaCodes);
    var stillMissing = areaCodes.filter(function (c) { return !(c in after); });
    if (stillMissing.length >= missing.length) return null; // 개선이 없으면 포기(명시적 실패 유지)
    return merged;
  }

  // 발코니/옵션 섹션은 문서 마지막 쪽이라 그 뒤에 "다음 대분류 제목"(NEXT_MAJOR_SECTION_RE)이
  // 없는 실제 문서가 많다. 이 경우 표 본문 뒤에 이어지는 긴 유의사항 산문까지 통째로
  // 섹션에 포함되는데, 그 산문 속에 우연히 타입 코드가 언급되면(예: "84A,B,C,D,E타입은
  // 소방 기준에 따라...") parseAmountByCodeSection이 이를 진짜 가격 행으로 오인해 엉뚱한
  // 금액을 집어온다(실사례로 확인). "■"/"▣"는 대부분 새 대분류 제목에 쓰이므로, 자기
  // 자신의 제목 다음에 나오는 첫 "■"/"▣"를 안전한 종료 경계로 쓴다.
  function findNextHeadingBoundary(text, afterIndex) {
    if (afterIndex < 0) return -1;
    var idx1 = text.indexOf('■', afterIndex + 1);
    var idx2 = text.indexOf('▣', afterIndex + 1);
    if (idx1 === -1) return idx2;
    if (idx2 === -1) return idx1;
    return Math.min(idx1, idx2);
  }

  // 다만 옵션(추가선택품목) 섹션은 에어컨/평면특화/공간특화/마감특화처럼 여러 항목별로 각자
  // 자기 이름의 "■ 항목명 [단위 : 원...]" 표 헤딩을 따로 갖는 문서가 있고(실사례: 의왕역
  // SK VIEW), 그 표 안에는 다른 항목을 참조하는 "■카테고리 ②...동시선택 불가" 같은 각주성
  // 인라인 불릿까지 섞여 나온다. 이런 문서에서 findNextHeadingBoundary처럼 "다음 ■ 하나"만
  // 보고 멈추면 첫 항목 표만 남기고 나머지 항목들을 통째로 잘라먹는다. 반대로 실제 표가 다
  // 끝나는 지점은 예외 없이 "납부일정/납부계좌/납부방법/유의사항/안내사항"류의 정산·안내성
  // 헤딩이므로, 그 키워드가 나올 때까지는(표 항목 전환이든 표 안 각주 참조든 상관없이) 계속
  // 다음 "■"/"▣"로 건너뛰며 스캔한다.
  // "납부일정"은 표 자체의 제목에도 흔히 쓰인다(예: "공급금액 및 납부일정", "발코니 확장
  // 공사비 및 납부일정" - 실사례: 부산 장안지구. 여기서 종료 경계로 오인하면 진짜 데이터
  // 표 헤딩 바로 다음에서 멈춰버려 표 내용이 통째로 잘린다). 반면 "납부계좌"/"납부방법"/
  // "유의사항"/"안내사항"은 결제 계좌·주의사항 안내문 특유의 표현으로, 표 자체의 제목으로
  // 쓰이는 사례가 없어 종료 경계로 써도 안전하다.
  var ADMIN_ENDING_HEADING_RE = /납부\s*(계좌|방법)|유의\s*사항|안내\s*사항/;
  function findSectionEndHeading(text, afterIndex) {
    var idx = afterIndex;
    while (true) {
      var next = findNextHeadingBoundary(text, idx);
      if (next < 0) return -1;
      var headingLine = text.slice(next, next + 60).split('\n')[0];
      if (ADMIN_ENDING_HEADING_RE.test(headingLine)) return next;
      idx = next;
    }
  }

  // 옵션 섹션 대분류 제목이 불릿 없이 "8 추가 선택품목(유상옵션)"처럼 번호만 붙어 나오고,
  // 실제 표는 그 아래 하위 항목(에어컨/평면특화 등, 문서마다 이름이 다름)의 "■" 헤딩에서
  // 시작하는 문서 대응: "줄 시작 + 숫자 + 옵션 관련 키워드" 자체는 앵커로 쓰지 않고(그
  // 문구가 본문 여러 곳에 산문으로도 등장해 오탐이 많다), 그 번호 헤딩 바로 다음에 오는
  // 첫 "■"/"▣"(=실제 첫 항목 표 헤딩) 위치만 후보로 취한다.
  // 번호 뒤에 ")"/"."가 붙는 문서도 있고("2) 추가선택사항 옵션품목" - 실사례: 목동윤슬자이
  // 오피스텔), "추가"와 "옵션품목" 사이에 끼는 말도 문서마다 제각각이라(추가선택/추가 선택/
  // 추가선택사항 등) 위 ■/▣ 기반 option 앵커와 같은 관대한 사이 구간 패턴을 그대로 쓴다.
  var CHAPTER_NUMBER_OPTION_RE = /^\d{1,2}[).]?\s*(추가[\s가-힣]{0,6}옵션품목|옵션품목|추가\s*선택\s*품목)/m;
  // 번호 헤딩 바로 뒤에 "1) FCU" / "3) 추가선택사항 유의사항"처럼 같은 목차 나열의 형제
  // 항목이 곧장 이어지는 문서가 있다(실사례: 송도국제도시 B1블록 대방디엠시티 오피스텔 -
  // "1) FCU / 2) 추가선택사항 옵션품목 / 3) 추가선택사항 유의사항" 세 줄이 목차로만 나열되고,
  // 실제 표는 그 뒤에 자기만의 ■/▣ 헤딩 없이 곧장 이어짐). 이런 경우 "다음 ■/▣ 헤딩까지
  // 건너뛰기"를 그대로 적용하면 문서 훨씬 뒤에 있는 무관한 대분류 제목까지 건너뛰어 그 사이의
  // 진짜 표를 통째로 잘라먹는다(실측: "▣ 계약조건 및 유의사항"까지 건너뛰어 옵션 표 자체가
  // 유실됨). 목차 형제 줄이 곧장 이어지는 동안은 그 블록 끝까지만 건너뛰고, 형제 줄이 없으면
  // (=단독 번호 헤딩이면) 기존대로 다음 실제 헤딩까지 건너뛴다(헤딩과 표 사이에 무관한 산문이
  // 낀 부산에코델타시티 디에트르 더 퍼스트류 문서 대응).
  var CHAPTER_SIBLING_LINE_RE = /^\d{1,2}[).]?\s+\S[^\n]*\n?/;
  function findChapterFirstHeading(text, chapterRe, fromIndex) {
    var sub = text.slice(fromIndex || 0);
    var m = sub.match(chapterRe);
    if (!m || m.index == null) return -1;
    var chapterIdx = (fromIndex || 0) + m.index;

    var lineEndOffset = sub.indexOf('\n', m.index);
    var afterChapterLine = lineEndOffset < 0 ? text.length : (fromIndex || 0) + lineEndOffset + 1;
    var cursor = afterChapterLine;
    while (cursor < text.length) {
      var lineMatch = CHAPTER_SIBLING_LINE_RE.exec(text.slice(cursor));
      if (!lineMatch || lineMatch.index !== 0) break;
      cursor += lineMatch[0].length;
    }
    if (cursor > afterChapterLine) return cursor;

    return findNextHeadingBoundary(text, chapterIdx);
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
    var optionChapterHeading = findChapterFirstHeading(text, CHAPTER_NUMBER_OPTION_RE, optionSearchFrom);
    if (optionChapterHeading >= 0 && (optionStart < 0 || optionChapterHeading < optionStart)) optionStart = optionChapterHeading;
    var nextMajorStart = findEarliestMatch(text, [NEXT_MAJOR_SECTION_RE], afterPrice);

    var area = sliceSection(text, areaStart, [priceStart]);
    var priceEndCandidates = [balconyStart, optionStart, nextMajorStart, findNextHeadingBoundary(text, priceStart)];
    var priceEndIdx = priceStart >= 0 ? computeSectionEnd(text, priceStart, priceEndCandidates) : -1;
    var price = sliceSection(text, priceStart, priceEndCandidates);
    var balconyEndCandidates = [optionStart, nextMajorStart, findSectionEndHeading(text, balconyStart)];
    var balconyEndIdx = balconyStart >= 0 ? computeSectionEnd(text, balconyStart, balconyEndCandidates) : -1;
    var balcony = sliceSection(text, balconyStart, balconyEndCandidates);
    var optionEndCandidates = [nextMajorStart, findSectionEndHeading(text, optionStart)];
    var optionEndIdx = optionStart >= 0 ? computeSectionEnd(text, optionStart, optionEndCandidates) : -1;
    var option = sliceSection(text, optionStart, optionEndCandidates);

    if (areaStart >= 0 && priceStart >= 0) {
      var repaired = repairMisplacedAreaTable(area, price);
      if (repaired) { area = repaired.area; price = repaired.price; }
      var repairedFrag = repairFragmentedAreaTable(area, price);
      if (repairedFrag) { area = repairedFrag.area; price = repairedFrag.price; }
    }

    if (areaStart >= 0 && priceStart >= 0) {
      var areaTypesForRepair = parseAreaSection(area);
      var areaCodes = areaTypesForRepair.map(function (a) { return a.code; });
      var firstPositive = function () {
        var best = -1;
        for (var i = 0; i < arguments.length; i++) {
          var v = arguments[i];
          if (v >= 0 && (best === -1 || v < best)) best = v;
        }
        return best;
      };
      var priceRepairBound = firstPositive(balconyStart, optionStart, nextMajorStart);
      var priceRepaired = repairFragmentedPriceTable(text, price, priceEndIdx, areaCodes, priceRepairBound);
      if (priceRepaired) { price = priceRepaired; }
      var priceRepaired2 = repairUndercountedPriceRows(text, price, priceEndIdx, areaTypesForRepair, priceRepairBound);
      if (priceRepaired2) { price = priceRepaired2; }

      if (balconyStart >= 0) {
        var balconyRepairBound = firstPositive(optionStart, nextMajorStart);
        var balconyRepaired = repairFragmentedAmountSection(text, balcony, balconyEndIdx, areaCodes, balconyRepairBound);
        if (balconyRepaired) { balcony = balconyRepaired; }
      }
      if (optionStart >= 0) {
        var optionRepairBound = firstPositive(nextMajorStart);
        var optionRepaired = repairFragmentedAmountSection(text, option, optionEndIdx, areaCodes, optionRepairBound);
        if (optionRepaired) { option = optionRepaired; }
      }
    }

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
    extractDong: extractDong,
    stripCatalogTables: stripCatalogTables
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  for (var k in api) { root[k] = api[k]; }
})(typeof window !== 'undefined' ? window : globalThis);
