/*
 * 분양가 정리 도구 - 프론트엔드 로직 (Agent B)
 * 사용 외부 함수: parseAreaSection, parsePriceSection, parseBalconySection,
 *                 parseOptionSection, extractMeta (parser.js)
 *                 buildBlock (excel.js), XLSX (SheetJS)
 */
(function () {
  'use strict';

  var LS_KEY = 'presale_tool_state_v1';
  var state = { units: [], selectedId: null };

  // ------------------------------------------------------------------
  // 상태 저장/복원 (localStorage 보조)
  // ------------------------------------------------------------------

  function reviveDates(unit) {
    ['open_dt', 'move_in_dt'].forEach(function (k) {
      if (unit[k]) unit[k] = new Date(unit[k]);
    });
    if (unit.mid_dates) unit.mid_dates = unit.mid_dates.map(function (d) { return d ? new Date(d) : null; });
    return unit;
  }

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 용량 초과 등은 무시, JSON 내보내기가 주 저장수단 */ }
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      parsed.units.forEach(reviveDates);
      state = parsed;
    } catch (e) { /* 무시 */ }
  }

  // ------------------------------------------------------------------
  // JSON 내보내기 / 불러오기 (주 저장 수단)
  // ------------------------------------------------------------------

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '분양가정리_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        parsed.units.forEach(reviveDates);
        state = parsed;
        saveLocal();
        renderTree();
        renderMain();
      } catch (e) {
        alert('JSON 파일을 읽을 수 없습니다: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------
  // 분석: 4분할 입력 텍스트 -> unit 객체
  // ------------------------------------------------------------------

  function moveInDate(year, month) {
    if (!year || !month) return null;
    return new Date(year, month, 0); // 해당 월 말일
  }

  function analyze(form) {
    var areaList = window.parseAreaSection(form.area);
    var codes = areaList.map(function (a) { return a.code; });
    var priceResult = window.parsePriceSection(form.price, codes);
    var balconyMap = window.parseBalconySection(form.balcony, codes);
    var optionMap = window.parseOptionSection(form.option, codes);
    var meta = window.extractMeta([form.price, form.area, form.balcony, form.option].join('\n'));

    var types = areaList.map(function (a) {
      var rows = priceResult.priceRows
        .filter(function (r) { return r.code === a.code; })
        .map(function (r) {
          return {
            dong: r.dong || '',
            floor: r.floor && r.floor.raw ? r.floor.raw : '',
            units: r.units,
            price: r.price
          };
        });
      return {
        code: a.code,
        exclusive_area: a.exclusive_area,
        supply_area: a.supply_area,
        supply_units: a.supply_units,
        balcony_ext_cost: balconyMap[a.code] || 0,
        option_cost: optionMap[a.code] || 0,
        rows: rows
      };
    });

    return {
      types: types,
      meta: meta,
      mid_dates: priceResult.midDates,
      unit_mult: priceResult.unit_mult,
      warnings: buildWarnings(areaList, priceResult, types)
    };
  }

  function buildWarnings(areaList, priceResult, types) {
    var warn = [];
    if (!areaList.length) warn.push('공급면적 섹션에서 인식된 주택형이 없습니다.');
    types.forEach(function (t) {
      if (!t.rows.length) warn.push('주택형 ' + t.code + '에 대응하는 가격 행을 찾지 못했습니다.');
    });
    return warn;
  }

  function readForm() {
    return {
      name: document.getElementById('f-name').value.trim(),
      r1: document.getElementById('f-r1').value,
      r2: document.getElementById('f-r2').value.trim(),
      kind: document.getElementById('f-kind').value,
      interest: document.getElementById('f-interest').value,
      rate: Number(document.getElementById('f-rate').value) || 0,
      price: document.getElementById('in-price').value,
      area: document.getElementById('in-area').value,
      balcony: document.getElementById('in-balcony').value,
      option: document.getElementById('in-option').value
    };
  }

  function runAnalyze() {
    var form = readForm();
    var result = analyze(form);
    var statusEl = document.getElementById('analyze-status');
    var msg = '주택형 ' + result.types.length + '개 인식됨, 가격행 ' +
      result.types.reduce(function (s, t) { return s + t.rows.length; }, 0) + '건';
    if (result.warnings.length) msg += '  ⚠ ' + result.warnings.join(' / ');
    statusEl.textContent = msg;
    statusEl.dataset.lastResult = JSON.stringify(result);
    return result;
  }

  function addUnit() {
    var form = readForm();
    if (!form.name) { alert('단지명을 입력하세요.'); return; }
    var result = analyze(form);
    var meta = result.meta;

    var unit = {
      id: 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: form.name, r1: form.r1, r2: form.r2, kind: form.kind,
      interest: form.interest, rate: form.rate,
      open_date: meta.open_date ? meta.open_date.toISOString().slice(0, 10) : null,
      open_dt: meta.open_date || null,
      move_in: (meta.move_in_year && meta.move_in_month) ? (meta.move_in_year + '.' + String(meta.move_in_month).padStart(2, '0')) : null,
      move_in_dt: moveInDate(meta.move_in_year, meta.move_in_month),
      mid_dates: result.mid_dates,
      types: result.types,
      raw: { price: form.price, area: form.area, balcony: form.balcony, option: form.option }
    };

    state.units.push(unit);
    state.selectedId = unit.id;
    saveLocal();
    renderTree();
    switchView('result');
    renderMain();
  }

  // ------------------------------------------------------------------
  // 사이드바 트리
  // ------------------------------------------------------------------

  function renderTree() {
    var root = document.getElementById('unit-tree');
    root.innerHTML = '';
    var byRegion = {};
    state.units.forEach(function (u) {
      var r1 = u.r1 || '기타';
      var r2 = u.r2 || '기타';
      byRegion[r1] = byRegion[r1] || {};
      byRegion[r1][r2] = byRegion[r1][r2] || [];
      byRegion[r1][r2].push(u);
    });
    Object.keys(byRegion).sort().forEach(function (r1) {
      var rEl = document.createElement('div');
      rEl.className = 'region';
      rEl.textContent = r1;
      root.appendChild(rEl);
      Object.keys(byRegion[r1]).sort().forEach(function (r2) {
        var sEl = document.createElement('div');
        sEl.className = 'sigungu';
        sEl.textContent = r2;
        root.appendChild(sEl);
        byRegion[r1][r2].forEach(function (u) {
          var item = document.createElement('div');
          item.className = 'unit-item' + (u.id === state.selectedId ? ' selected' : '');
          item.textContent = u.name;
          item.onclick = function () { state.selectedId = u.id; renderTree(); renderMain(); };
          root.appendChild(item);
        });
      });
    });
  }

  function selectedUnit() {
    return state.units.find(function (u) { return u.id === state.selectedId; });
  }

  // ------------------------------------------------------------------
  // 결과 메인 (요약 / 데이터수정 / 원본입력 서브탭)
  // ------------------------------------------------------------------

  var currentSubtab = 'summary';

  function computeRowDerived(unit, type, row) {
    var C = type.supply_area * 0.3025;
    var I = row.price || 0;
    var J = C ? I / C : 0;
    var K = type.balcony_ext_cost || 0;
    var L = I + K;
    var M = C ? L / C : 0;
    var N = type.option_cost || 0;
    var O = I + N;
    var P = C ? O / C : 0;
    var interestTotal = 0;
    if (!/무이자/.test(unit.interest || '') && unit.move_in_dt) {
      (unit.mid_dates || []).forEach(function (d) {
        if (!d) return;
        var days = Math.round((unit.move_in_dt.getTime() - d.getTime()) / 86400000);
        if (days > 0) interestTotal += I * 0.1 * (unit.rate / 100) * days / 365;
      });
    }
    var Q = interestTotal;
    var R = Q + O;
    var S = C ? R / C : 0;
    return { C: C, J: J, K: K, L: L, M: M, N: N, O: O, Q: Q, R: R, S: S };
  }

  function fmt(n) {
    if (n == null || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR');
  }
  function fmt1(n) {
    if (n == null || isNaN(n)) return '-';
    return n.toFixed(1);
  }

  function renderSummary(unit) {
    var html = '<table class="result-table"><thead><tr>' +
      '<th>약식</th><th>전용</th><th>공급</th><th>평수</th><th>세대수</th>' +
      '<th>동/라인</th><th>층별</th><th>분양가</th><th>평당가</th>' +
      '<th>확장포함</th><th>확장평당가</th><th>에어컨포함</th><th>최종분양가</th><th>최종평당가</th>' +
      '</tr></thead><tbody>';

    unit.types.forEach(function (type) {
      var sumUnits = 0, sumPriceUnits = 0, sumFinalUnits = 0, sumFinalPyeongUnits = 0;
      type.rows.forEach(function (row) {
        var d = computeRowDerived(unit, type, row);
        var u = row.units || 0;
        sumUnits += u;
        sumPriceUnits += (row.price || 0) * u;
        sumFinalUnits += d.R * u;
        sumFinalPyeongUnits += d.S * u;
        html += '<tr>' +
          '<td class="left">' + type.code + '</td>' +
          '<td>' + fmt(type.exclusive_area) + '</td>' +
          '<td>' + fmt(type.supply_area) + '</td>' +
          '<td>' + fmt1(type.supply_area * 0.3025) + '</td>' +
          '<td>' + (row.units != null ? row.units : '-') + '</td>' +
          '<td class="left">' + (row.dong || '-') + '</td>' +
          '<td class="left">' + (row.floor || '-') + '</td>' +
          '<td>' + fmt(row.price) + '</td>' +
          '<td>' + fmt(d.J) + '</td>' +
          '<td>' + fmt(d.L) + '</td>' +
          '<td>' + fmt(d.M) + '</td>' +
          '<td>' + fmt(d.O) + '</td>' +
          '<td>' + fmt(d.R) + '</td>' +
          '<td>' + fmt(d.S) + '</td>' +
          '</tr>';
      });
      if (type.rows.length > 1 && sumUnits > 0) {
        html += '<tr class="subtotal"><td class="left" colspan="6">소계 (' + type.code + ')</td>' +
          '<td colspan="1"></td>' +
          '<td>' + fmt(sumPriceUnits / sumUnits) + '</td>' +
          '<td>' + fmt((sumPriceUnits / sumUnits) / (type.supply_area * 0.3025)) + '</td>' +
          '<td colspan="2"></td>' +
          '<td></td>' +
          '<td>' + fmt(sumFinalUnits / sumUnits) + '</td>' +
          '<td>' + fmt(sumFinalPyeongUnits / sumUnits) + '</td>' +
          '</tr>';
      }
    });
    html += '</tbody></table>';
    if (!unit.types.length) html = '<div class="empty-hint">인식된 주택형이 없습니다. 입력 탭에서 데이터를 확인하세요.</div>';
    return html;
  }

  function renderEdit(unit) {
    var html = '<table class="result-table"><thead><tr>' +
      '<th>약식</th><th>동/라인</th><th>층별</th><th>세대수</th><th>분양가</th><th>작업</th>' +
      '</tr></thead><tbody>';
    unit.types.forEach(function (type, ti) {
      type.rows.forEach(function (row, ri) {
        var key = ti + '_' + ri;
        html += '<tr data-key="' + key + '">' +
          '<td class="left">' + type.code + '</td>' +
          '<td class="editable left"><input data-field="dong" value="' + (row.dong || '') + '" /></td>' +
          '<td class="editable left"><input data-field="floor" value="' + (row.floor || '') + '" /></td>' +
          '<td class="editable"><input data-field="units" type="number" value="' + (row.units != null ? row.units : '') + '" /></td>' +
          '<td class="editable"><input data-field="price" type="number" value="' + (row.price != null ? row.price : '') + '" /></td>' +
          '<td class="edit-row-actions">' +
          '<button class="secondary small" onclick="PresaleApp.saveRow(\'' + ti + '\',\'' + ri + '\')">저장</button>' +
          '<button class="secondary small" onclick="PresaleApp.renderMain()">취소</button>' +
          '</td></tr>';
      });
    });
    html += '</tbody></table>';
    return html;
  }

  function saveRow(ti, ri) {
    var unit = selectedUnit();
    if (!unit) return;
    var tr = document.querySelector('tr[data-key="' + ti + '_' + ri + '"]');
    if (!tr) return;
    var row = unit.types[ti].rows[ri];
    tr.querySelectorAll('input').forEach(function (input) {
      var f = input.dataset.field;
      row[f] = (f === 'units' || f === 'price') ? Number(input.value) : input.value;
    });
    saveLocal();
    renderMain();
  }

  function renderRaw(unit) {
    var text = [
      '=== ① 공급금액 및 납부일정 ===', unit.raw.price,
      '', '=== ② 공급면적 및 공급규모 ===', unit.raw.area,
      '', '=== ③ 발코니 확장비 ===', unit.raw.balcony,
      '', '=== ④ 에어컨 옵션가 ===', unit.raw.option
    ].join('\n');
    return '<textarea readonly>' + escapeHtml(text) + '</textarea>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderMain() {
    var main = document.getElementById('result-main');
    var unit = selectedUnit();
    if (!unit) {
      main.innerHTML = '<div class="empty-hint">왼쪽 목록에서 단지를 선택하세요.</div>';
      return;
    }
    var body = currentSubtab === 'summary' ? renderSummary(unit)
      : currentSubtab === 'edit' ? renderEdit(unit)
      : renderRaw(unit);

    main.innerHTML =
      '<h3 style="margin-top:0;">' + escapeHtml(unit.name) + ' <span style="font-weight:400;color:var(--sub);font-size:13px;">(' + unit.r1 + ' ' + unit.r2 + ')</span></h3>' +
      '<div class="subtabs">' +
      '<button data-sub="summary" class="' + (currentSubtab === 'summary' ? 'active' : '') + '">📈 요약</button>' +
      '<button data-sub="edit" class="' + (currentSubtab === 'edit' ? 'active' : '') + '">✏️ 데이터 수정</button>' +
      '<button data-sub="raw" class="' + (currentSubtab === 'raw' ? 'active' : '') + '">📄 원본 입력</button>' +
      '</div>' +
      '<div id="subview-body">' + body + '</div>';

    main.querySelectorAll('.subtabs button').forEach(function (btn) {
      btn.onclick = function () { currentSubtab = btn.dataset.sub; renderMain(); };
    });
  }

  // ------------------------------------------------------------------
  // 엑셀 다운로드
  // ------------------------------------------------------------------

  function doExport() {
    if (!state.units.length) { alert('내보낼 단지가 없습니다.'); return; }
    var ws = {};
    var merges = [];
    var rh = [];
    var row = 0;
    var maxCol = 0;
    state.units.forEach(function (unit) {
      row = window.buildBlock(ws, merges, rh, unit, row);
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(row, 1), c: 63 } });
    ws['!merges'] = merges;
    var wb = { SheetNames: ['분양가정리'], Sheets: { '분양가정리': ws } };
    XLSX.writeFile(wb, '분양가정리_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  // ------------------------------------------------------------------
  // 네비게이션 / 초기화
  // ------------------------------------------------------------------

  function switchView(name) {
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    document.getElementById('view-input').classList.toggle('active', name === 'input');
    document.getElementById('view-result').classList.toggle('active', name === 'result');
  }

  function init() {
    loadLocal();
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.onclick = function () { switchView(b.dataset.view); if (b.dataset.view === 'result') { renderTree(); renderMain(); } };
    });
    document.getElementById('btn-analyze').onclick = runAnalyze;
    document.getElementById('btn-add').onclick = addUnit;
    document.getElementById('btn-export-excel').onclick = doExport;
    document.getElementById('btn-save-json').onclick = exportJSON;
    document.getElementById('file-import').onchange = function (e) {
      if (e.target.files[0]) importJSON(e.target.files[0]);
    };
    renderTree();
    renderMain();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.PresaleApp = {
    exportJSON: exportJSON, importJSON: importJSON, analyze: analyze,
    saveRow: saveRow, renderMain: renderMain, getState: function () { return state; },
    setState: function (s) { state = s; }
  };
})();
