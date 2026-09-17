/*
 * 분양가 정리 도구 - 엑셀 빌더 (Agent C)
 *
 * Contract: buildBlock(sd, merges, rh, unit, startRow) -> nextRow
 *   sd      : SheetJS worksheet 객체 (셀을 직접 기록)
 *   merges  : 병합 범위를 push할 배열 (SheetJS !merges 규약, 0-based {s:{r,c}, e:{r,c}})
 *   rh      : 행 높이를 push할 배열 (SheetJS !rows 규약, 0-based index로 접근)
 *   unit    : 단지 데이터 (아래 shape 참고)
 *   startRow: 이 블록을 쓰기 시작할 0-based 행 번호
 *
 * unit = {
 *   name, r1, r2, kind, interest, rate,
 *   open_date, open_dt, move_in, move_in_dt,
 *   mid_dates: [Date x6],
 *   types: [{ code, exclusive_area, supply_area, supply_units,
 *             balcony_ext_cost, option_cost,
 *             rows: [{dong, floor, units, price}] }]
 * }
 *
 * 열 배치: A~S (본문), BE~BK (중도금 회차별 이자 + 합계, 화면에는 숨김열로 둘 수 있음)
 */
(function (root) {
  'use strict';

  var HEADERS = [
    '전용면적', '공급면적', '공급평수', '공급세대수', '약식표기',
    '동/라인', '층별', '세대수', '분양가', '평당가',
    '확장비', '확장포함분양가', '확장포함평당가',
    '에어컨', '에어컨포함분양가', '에어컨포함평당가',
    '중도금이자합계', '최종분양가', '최종평당가'
  ]; // A..S (19개 컬럼)

  var PYEONG = 0.3025;
  var DAY_MS = 86400000;

  function colLetter(c) {
    // c: 0-based
    var s = '';
    c += 1;
    while (c > 0) {
      var r = (c - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  function ref(r, c) { return colLetter(c) + (r + 1); }

  function setCell(sd, r, c, value, opts) {
    var cell = {};
    if (opts && opts.f) {
      cell.t = 'n';
      cell.f = opts.f;
      cell.v = typeof value === 'number' ? value : 0;
    } else if (typeof value === 'number') {
      cell.t = 'n';
      cell.v = value;
    } else if (value instanceof Date) {
      cell.t = 'd';
      cell.v = value;
    } else {
      cell.t = 's';
      cell.v = value == null ? '' : String(value);
    }
    if (opts && opts.z) cell.z = opts.z;
    sd[ref(r, c)] = cell;
    return cell;
  }

  function mergeIf(merges, r1, c1, r2, c2) {
    if (r1 === r2 && c1 === c2) return;
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  }

  function isInterestFree(unit) {
    return /무이자/.test(String(unit.interest || ''));
  }

  // 회차별(0~5) 이자 계산에 쓸 (금리, 일수) 상수를 산출. 무이자/날짜없음이면 null.
  function midInterestConst(unit, phaseIdx) {
    if (isInterestFree(unit)) return null;
    var d = unit.mid_dates && unit.mid_dates[phaseIdx];
    if (!d || !unit.move_in_dt) return null;
    var days = Math.round((unit.move_in_dt.getTime() - d.getTime()) / DAY_MS);
    if (!isFinite(days) || days <= 0) return null;
    var ratePct = Number(unit.rate) || 0;
    return { rate: ratePct / 100, days: days };
  }

  function writeHeaderRow(sd, merges, row, unit) {
    var title = [
      unit.name,
      [unit.r1, unit.r2].filter(Boolean).join(' '),
      unit.kind,
      '중도금:' + (unit.interest || '-'),
      '금리:' + (unit.rate != null ? unit.rate + '%' : '-'),
      '공고일:' + (unit.open_date || '-'),
      '입주:' + (unit.move_in || '-')
    ].filter(Boolean).join('  |  ');
    setCell(sd, row, 0, title);
    mergeIf(merges, row, 0, row, 18);
    return row + 1;
  }

  function writeColumnHeader(sd, row) {
    for (var c = 0; c < HEADERS.length; c++) setCell(sd, row, c, HEADERS[c]);
    // BE~BJ: 중도금 회차 라벨, BK: 내부 합계
    for (var i = 0; i < 6; i++) setCell(sd, row, 56 + i, '중도금' + (i + 1) + '차이자');
    setCell(sd, row, 62, '중도금이자합계(내부)');
    return row + 1;
  }

  function writeDataRow(sd, row, unit, type, dataRow) {
    var C_col = 2, I_col = 8; // A=0,B=1,C=2,...
    // F~H: 동/라인, 층별, 세대수
    setCell(sd, row, 5, dataRow.dong || '');
    setCell(sd, row, 6, dataRow.floor || '');
    setCell(sd, row, 7, dataRow.units != null ? dataRow.units : '');
    // I: 분양가
    setCell(sd, row, 8, dataRow.price || 0);
    // J: 평당가 = I/C
    setCell(sd, row, 9, dataRow.price && type.supply_area ? dataRow.price / (type.supply_area * PYEONG) : 0,
      { f: ref(row, 8) + '/' + ref(row, 2) });
    // K: 확장비 (상수), L: I+K, M: L/C
    var K = type.balcony_ext_cost || 0;
    setCell(sd, row, 10, K);
    setCell(sd, row, 11, (dataRow.price || 0) + K, { f: ref(row, 8) + '+' + ref(row, 10) });
    setCell(sd, row, 12, 0, { f: ref(row, 11) + '/' + ref(row, 2) });
    // N: 에어컨 (상수), O: I+N, P: O/C
    var N = type.option_cost || 0;
    setCell(sd, row, 13, N);
    setCell(sd, row, 14, (dataRow.price || 0) + N, { f: ref(row, 8) + '+' + ref(row, 13) });
    setCell(sd, row, 15, 0, { f: ref(row, 14) + '/' + ref(row, 2) });

    // BE~BJ: 회차별 중도금 이자
    var sumParts = [];
    for (var i = 0; i < 6; i++) {
      var col = 56 + i;
      var k = midInterestConst(unit, i);
      var cellRef = ref(row, col);
      if (!k) {
        setCell(sd, row, col, 0);
      } else {
        var amount = (dataRow.price || 0) * 0.1 * k.rate * k.days / 365;
        setCell(sd, row, col, amount, { f: '(' + ref(row, 8) + '*0.1)*' + k.rate + '*' + k.days + '/365' });
      }
      sumParts.push(cellRef);
    }
    // BK: SUM(BE:BJ)
    var bkVal = 0;
    for (var s = 0; s < 6; s++) {
      var kk = midInterestConst(unit, s);
      bkVal += kk ? (dataRow.price || 0) * 0.1 * kk.rate * kk.days / 365 : 0;
    }
    setCell(sd, row, 62, bkVal, { f: 'SUM(' + ref(row, 56) + ':' + ref(row, 61) + ')' });

    // Q: = BK   R: = Q+O   S: = R/C
    setCell(sd, row, 16, bkVal, { f: ref(row, 62) });
    setCell(sd, row, 17, bkVal + ((dataRow.price || 0) + N), { f: ref(row, 16) + '+' + ref(row, 14) });
    setCell(sd, row, 18, 0, { f: ref(row, 17) + '/' + ref(row, 2) });
  }

  // SUMPRODUCT 가중평균 셀 기록: valCol/weightCol 범위(r1..r2)의 가중평균
  function writeWeightedRow(sd, row, r1, r2, colsToWeight, hCol) {
    var hRef1 = ref(r1, hCol), hRef2 = ref(r2, hCol);
    var sumH = 'SUM(' + hRef1 + ':' + hRef2 + ')';
    setCell(sd, row, hCol, null, { f: sumH });

    colsToWeight.forEach(function (c) {
      var vRef1 = ref(r1, c), vRef2 = ref(r2, c);
      var f = 'SUMPRODUCT(' + vRef1 + ':' + vRef2 + ',' + hRef1 + ':' + hRef2 + ')/' + sumH;
      setCell(sd, row, c, null, { f: f });
    });
  }

  function buildBlock(sd, merges, rh, unit, startRow) {
    var row = startRow;
    row = writeHeaderRow(sd, merges, row, unit);
    row = writeColumnHeader(sd, row);

    var typeSubtotalRows = []; // {row, dataStart, dataEnd}

    unit.types.forEach(function (type) {
      var dataStart = row;
      var C = type.supply_area * PYEONG;

      (type.rows || []).forEach(function (r) {
        writeDataRow(sd, row, unit, type, r);
        row++;
      });
      var dataEnd = row - 1;

      // A~E: 타입 공통값, 데이터 구간 전체에 병합
      setCell(sd, dataStart, 0, type.exclusive_area);
      setCell(sd, dataStart, 1, type.supply_area);
      setCell(sd, dataStart, 2, C, { f: ref(dataStart, 1) + '*' + PYEONG });
      setCell(sd, dataStart, 3, type.supply_units);
      setCell(sd, dataStart, 4, type.code);
      if (dataEnd > dataStart) {
        mergeIf(merges, dataStart, 0, dataEnd, 0);
        mergeIf(merges, dataStart, 1, dataEnd, 1);
        mergeIf(merges, dataStart, 2, dataEnd, 2);
        mergeIf(merges, dataStart, 3, dataEnd, 3);
        mergeIf(merges, dataStart, 4, dataEnd, 4);
      }

      // 소계행 (해당 타입 내 층구분이 2개 이상일 때만 의미 있음)
      if (dataEnd > dataStart) {
        var subRow = row;
        setCell(sd, subRow, 5, '소계');
        setCell(sd, subRow, 0, type.exclusive_area);
        setCell(sd, subRow, 1, type.supply_area);
        setCell(sd, subRow, 2, C, { f: ref(subRow, 1) + '*' + PYEONG });
        setCell(sd, subRow, 3, type.supply_units);
        setCell(sd, subRow, 4, type.code);
        writeWeightedRow(sd, subRow, dataStart, dataEnd, [9, 11, 12, 14, 15, 16, 17, 18].concat([56, 57, 58, 59, 60, 61, 62]), 7);
        // I(분양가), K, N은 가중평균으로 재계산
        writeWeightedRow(sd, subRow, dataStart, dataEnd, [8, 10, 13], 7);
        typeSubtotalRows.push({ row: subRow, isSubtotal: true });
        row++;
      } else {
        typeSubtotalRows.push({ row: dataStart, isSubtotal: false });
      }
    });

    // 합계행: 타입별 가중평균 (H=세대수 기준)
    if (typeSubtotalRows.length > 1) {
      var totalRow = row;
      setCell(sd, totalRow, 5, '합계');
      var rowsList = typeSubtotalRows.map(function (x) { return x.row; });
      // 개별(비연속) 행 가중평균은 SUMPRODUCT 배열 대신 개별 항목 합으로 구성
      var hTerms = rowsList.map(function (r) { return ref(r, 7); });
      var sumHExpr = hTerms.join('+');
      setCell(sd, totalRow, 7, null, { f: sumHExpr });
      [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].forEach(function (c) {
        var terms = rowsList.map(function (r) { return ref(r, c) + '*' + ref(r, 7); });
        setCell(sd, totalRow, c, null, { f: '(' + terms.join('+') + ')/(' + sumHExpr + ')' });
      });
      row++;
    }

    return row + 1; // 다음 블록 시작 전 빈 줄 하나
  }

  var api = { buildBlock: buildBlock, colLetter: colLetter, ref: ref, HEADERS: HEADERS, PYEONG: PYEONG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  for (var k in api) root[k] = api[k];
})(typeof window !== 'undefined' ? window : globalThis);
