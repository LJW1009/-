"use strict";

/* ============================================================
   상태
   ============================================================ */
const state = {
  excel: { zip: null, bytes: null, sheets: [], tabs: [], mode: "new", laws: [] },
  ppt: { items: [""], changes: [["", "", ""]], timeline: [["", "", ""]], opinion: [""], infoCards: [] },
};

/* ============================================================
   탭 전환
   ============================================================ */
function initTabs() {
  $all(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $all(".tab-btn").forEach((b) => b.classList.remove("active"));
      $all(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#" + btn.dataset.tab).classList.add("active");
    });
  });
}

/* ============================================================
   EXCEL 탭
   ============================================================ */
function initExcelTab() {
  $("#xlsx-file").addEventListener("change", onXlsxSelected);
  $all('input[name="mode"]').forEach((r) => r.addEventListener("change", onModeChange));
  $("#add-law-btn").addEventListener("click", () => {
    state.excel.laws.push({ id: uid(), name: "", enforcement: "", reason: "", noImpact: false, impact: "", rows: [] });
    renderLaws();
  });
  $("#gen-excel-btn").addEventListener("click", onGenerateExcel);
}

async function onXlsxSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  $("#xlsx-status").textContent = "읽는 중...";
  const bytes = await file.arrayBuffer();
  try {
    const zip = await JSZip.loadAsync(bytes);
    const sheets = await listSheets(zip);
    if (!sheets.includes("품의용 갑지")) {
      $("#xlsx-status").innerHTML = '<span class="err">⚠ "품의용 갑지" 시트를 찾을 수 없습니다. 올바른 원본 파일인지 확인하세요.</span>';
      return;
    }
    state.excel.zip = zip;
    state.excel.bytes = bytes;
    state.excel.sheets = sheets;
    state.excel.tabs = monthTabs(sheets, DEFAULT_DEPT);
    const latest = state.excel.tabs[0];
    $("#xlsx-status").innerHTML = `시트 <b>${sheets.length}</b>개 확인. 최신 월 탭: <b>${latest ? latest[0] : "없음"}</b>`;
    $("#excel-form").hidden = false;

    if (latest) {
      const [y, m] = latest[1].split("-").map(Number);
      let ny = y, nm = m + 1;
      if (nm > 12) { nm = 1; ny++; }
      $("#year-month").value = `${ny}-${String(nm).padStart(2, "0")}`;
    }
    renderTargetSheetSelect();
    await renderStylePreview();
  } catch (err) {
    $("#xlsx-status").innerHTML = `<span class="err">엑셀 파일을 읽는 중 오류: ${err.message}</span>`;
  }
}

function onModeChange(e) {
  state.excel.mode = e.target.value;
  $("#new-month-fields").hidden = state.excel.mode !== "new";
  $("#append-fields").hidden = state.excel.mode !== "append";
  renderTargetSheetSelect();
}

function renderTargetSheetSelect() {
  const sel = $("#target-sheet-select");
  sel.innerHTML = "";
  for (const [name] of state.excel.tabs) {
    sel.appendChild(el("option", { value: name, text: name }));
  }
}

async function renderStylePreview() {
  const box = $("#style-preview");
  box.innerHTML = "";
  const latest = state.excel.tabs[0];
  if (!latest) { box.textContent = "(YYYY.MM 영업계획팀 형식의 기존 탭이 없습니다)"; return; }
  const path = await findSheetPath(state.excel.zip, latest[0]);
  const styles = await extractCellStyles(state.excel.zip, path);
  const stylesInfo = await readStylesInfo(state.excel.zip);
  const r6 = styles[6] || {};
  const table = el("table", { class: "mini-table" }, []);
  table.appendChild(el("tr", {}, [el("th", { text: "항목" }), el("th", { text: "style" }), el("th", { text: "색상" }), el("th", { text: "굵게" })]));
  const rows7 = styles[7] || {};
  const candidates = [
    ["변경없음(C6)", r6.C6],
    ["변경있음(D7, 있다면)", rows7.D7 || r6.D6],
  ];
  for (const [label, idx] of candidates) {
    if (!idx) continue;
    const sig = fontSignature(stylesInfo, idx);
    table.appendChild(el("tr", {}, [
      el("td", { text: label }), el("td", { text: idx }),
      el("td", { text: (sig && sig.rgb) || "-" }), el("td", { text: sig && sig.bold ? "Y" : "N" }),
    ]));
  }
  box.appendChild(el("p", { class: "hint", text: `"${latest[0]}" 기준, 이 파일에서 방금 새로 추출한 값입니다.` }));
  box.appendChild(table);
}

function renderLaws() {
  const container = $("#laws-container");
  container.innerHTML = "";
  state.excel.laws.forEach((law, li) => {
    const card = el("div", { class: "card" }, []);
    card.appendChild(el("div", { class: "card-title", text: `법령 ${li + 1}${law.name ? " — " + law.name : ""}` }));

    const nameInput = el("input", { type: "text", placeholder: "법률명칭", value: law.name });
    nameInput.addEventListener("input", (e) => { law.name = e.target.value; });
    const enfInput = el("input", { type: "text", placeholder: "[시행 2026. 9. 1] [법률 제00000호, ...]", value: law.enforcement });
    enfInput.addEventListener("input", (e) => { law.enforcement = e.target.value; });
    card.appendChild(el("div", { class: "row2" }, [
      el("label", {}, [document.createTextNode("법률명칭"), nameInput]),
      el("label", {}, [document.createTextNode("시행일·법령번호"), enfInput]),
    ]));

    const reasonInput = el("textarea", { rows: "2", placeholder: "개정이유" }, []);
    reasonInput.value = law.reason;
    reasonInput.addEventListener("input", (e) => { law.reason = e.target.value; });
    card.appendChild(el("label", {}, [document.createTextNode("개정이유"), reasonInput]));

    const noImpactChk = el("input", { type: "checkbox" });
    noImpactChk.checked = law.noImpact;
    const impactInput = el("textarea", { rows: "2", placeholder: "당사 관련성(비우면 impact 행 생성 안 함)" }, []);
    impactInput.value = law.impact;
    impactInput.disabled = law.noImpact;
    noImpactChk.addEventListener("change", (e) => {
      law.noImpact = e.target.checked;
      law.impact = law.noImpact ? "당사와 관련없음" : "";
      impactInput.value = law.impact;
      impactInput.disabled = law.noImpact;
    });
    impactInput.addEventListener("input", (e) => { law.impact = e.target.value; });
    const impactLabel = el("label", { class: "checkbox-label" }, [noImpactChk, document.createTextNode(" 당사와 관련없음")]);
    card.appendChild(impactLabel);
    card.appendChild(impactInput);

    card.appendChild(el("div", { class: "subtitle", text: "조문 행" }));
    const rowsBox = el("div", { class: "rows-box" }, []);
    law.rows.forEach((row, ri) => {
      const kindSel = el("select", {}, ["head", "same", "change"].map((k) => el("option", { value: k, text: k })));
      kindSel.value = row.kind;
      kindSel.addEventListener("change", (e) => { row.kind = e.target.value; });
      const beforeTa = el("textarea", { rows: "2", placeholder: "변경전" }, []);
      beforeTa.value = row.before;
      beforeTa.addEventListener("input", (e) => { row.before = e.target.value; });
      const afterTa = el("textarea", { rows: "2", placeholder: "변경후" }, []);
      afterTa.value = row.after;
      afterTa.addEventListener("input", (e) => { row.after = e.target.value; });
      const delBtn = el("button", { class: "btn-icon", text: "🗑", type: "button" }, []);
      delBtn.addEventListener("click", () => { law.rows.splice(ri, 1); renderLaws(); });
      rowsBox.appendChild(el("div", { class: "row-item" }, [kindSel, beforeTa, afterTa, delBtn]));
    });
    card.appendChild(rowsBox);

    const addRowBtn = el("button", { class: "btn-secondary", type: "button", text: "➕ 조문 행 추가" }, []);
    addRowBtn.addEventListener("click", () => { law.rows.push({ kind: "same", before: "", after: "" }); renderLaws(); });
    card.appendChild(addRowBtn);

    const bulkDetails = el("details", { class: "style-preview" }, []);
    bulkDetails.appendChild(el("summary", { text: "🪄 빠른 입력: 신구조문대비표 붙여넣기 (변경전/변경후 줄 단위 자동 매칭)" }));
    bulkDetails.appendChild(el("p", { class: "hint", text: "법제처 신구조문대비표에서 변경전·변경후를 각각 복사해 붙여넣으면, 줄 단위로 짝지어 조문 행을 자동 생성합니다. \"제N조\" 로 시작하는 줄은 head, 두 줄이 완전히 같으면 same, 그 외엔 change로 분류합니다 — 생성 후 꼭 확인하세요." }));
    const bulkRow = el("div", { class: "row2" }, []);
    const bulkBefore = el("textarea", { rows: "6", placeholder: "변경전 전체를 여기 붙여넣기 (줄바꿈 유지)" }, []);
    const bulkAfter = el("textarea", { rows: "6", placeholder: "변경후 전체를 여기 붙여넣기 (줄바꿈 유지, 변경전과 줄 수를 맞춰주세요)" }, []);
    bulkRow.appendChild(el("label", {}, [document.createTextNode("변경전"), bulkBefore]));
    bulkRow.appendChild(el("label", {}, [document.createTextNode("변경후"), bulkAfter]));
    bulkDetails.appendChild(bulkRow);
    const bulkBtn = el("button", { class: "btn-secondary", type: "button", text: "🪄 이 내용으로 조문 행 자동 생성" }, []);
    bulkBtn.addEventListener("click", () => {
      const result = bulkParseRows(bulkBefore.value, bulkAfter.value);
      if (result.rows.length === 0) { toast("붙여넣은 내용이 없습니다.", "err"); return; }
      law.rows.push(...result.rows);
      toast(
        result.warning ? `${result.rows.length}행 생성됨 — ${result.warning}` : `${result.rows.length}행 생성됨. 아래에서 kind·내용을 확인하세요.`,
        result.warning ? "" : "ok"
      );
      renderLaws();
    });
    bulkDetails.appendChild(bulkBtn);
    card.appendChild(bulkDetails);

    const delLawBtn = el("button", { class: "btn-danger", type: "button", text: "🗑 이 법령 삭제" }, []);
    delLawBtn.addEventListener("click", () => { state.excel.laws.splice(li, 1); renderLaws(); });
    card.appendChild(delLawBtn);

    container.appendChild(card);
  });
}

async function onGenerateExcel() {
  const resultBox = $("#excel-result");
  resultBox.innerHTML = "";
  const { zip, bytes, mode, laws } = state.excel;
  if (!zip) { toast("먼저 원본 xlsx를 업로드하세요.", "err"); return; }

  const noChanges = $("#no-changes-chk").checked;
  if (mode === "new" && !noChanges && laws.length === 0) { toast("법령을 추가하거나 '변경사항 없음'을 체크하세요.", "err"); return; }
  if (mode === "append" && laws.length === 0) { toast("추가할 법령을 입력하세요.", "err"); return; }

  const lawsPayload = laws.map((law) => ({
    name: law.name, enforcement: law.enforcement, reason: law.reason,
    impact: law.impact || null,
    rows: law.rows.map((r) => ({ kind: r.kind, before: r.before, after: r.after })),
  }));

  try {
    let outLabel;
    const targetSheetForStyle = mode === "new" ? (state.excel.tabs[0] || [])[0] : $("#target-sheet-select").value;
    if (!targetSheetForStyle) throw new Error("스타일을 추출할 기준 시트를 찾을 수 없습니다.");

    const pumPath = await findSheetPath(zip, "품의용 갑지");
    const monPath = await findSheetPath(zip, targetSheetForStyle);
    const pumStyles = await extractCellStyles(zip, pumPath);
    const monStyles = await extractCellStyles(zip, monPath);
    const pick = (m, ref) => pickStyle(m, ref);

    if (mode === "new") {
      const yearMonth = $("#year-month").value.trim();
      const department = $("#department").value.trim() || DEFAULT_DEPT;
      if (!noChanges && !/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error("연월은 YYYY-MM 형식으로 입력하세요.");

      const S_MON = {
        title: pick(monStyles, "A2"), title_c: pick(monStyles, "B2"),
        h_a1: pick(monStyles, "A4"), h_a2: pick(monStyles, "A5"),
        h_b1: pick(monStyles, "B4"), h_b2: pick(monStyles, "B5"),
        h_c1: pick(monStyles, "C4"), h_c2: pick(monStyles, "C5"),
        dept: pick(monStyles, "A6"), law: pick(monStyles, "B6"),
        head_c: "387", head_d: "377",
        same_c: pick(monStyles, "C6") || "396", same_d: pick(monStyles, "D6") || "397",
        chg_c: pick(monStyles, "C7") || "398", chg_d: pick(monStyles, "D7") || "399",
        reason_lbl: pick(monStyles, "B8") || "361",
        reason_c: pick(monStyles, "C8") || "408", reason_d: pick(monStyles, "D8") || "409",
        impact_c: "413", impact_d: "414",
      };
      const S_PUM = {
        hdr: pick(pumStyles, "B2"), law: pick(pumStyles, "B3"),
        head_c: "391", head_d: "391",
        same_c: pick(pumStyles, "C3") || "391", same_d: pick(pumStyles, "D3") || "391",
        chg_c: pick(pumStyles, "C4") || "392", chg_d: pick(pumStyles, "D4") || "393",
        reason_lbl: pick(pumStyles, "B5") || "394",
        reason_c: pick(pumStyles, "C5") || "411", reason_d: pick(pumStyles, "D5") || "412",
        impact_c: pick(pumStyles, "C5") || "411", impact_d: pick(pumStyles, "D5") || "412",
      };
      const payload = { yearMonth, department, noChanges, laws: lawsPayload, styles: { mon: S_MON, pum: S_PUM } };
      const result = await buildLegalSheetNewMonth(zip, payload);
      outLabel = result.sheetName;
    } else {
      const S_MON = {
        dept: pick(monStyles, "A6") || "400", law: pick(monStyles, "B6") || "407",
        same_c: pick(monStyles, "C6") || "396", same_d: pick(monStyles, "D6") || "397",
        chg_c: pick(monStyles, "C7") || "398", chg_d: pick(monStyles, "D7") || "399",
        reason_lbl: pick(monStyles, "B8") || "361",
        reason_c: pick(monStyles, "C8") || "408", reason_d: pick(monStyles, "D8") || "409",
      };
      const S_PUM = {
        law: pick(pumStyles, "B3") || "410",
        same_c: pick(pumStyles, "C3") || "391", same_d: pick(pumStyles, "D3") || "391",
        chg_c: pick(pumStyles, "C4") || "392", chg_d: pick(pumStyles, "D4") || "393",
        reason_lbl: pick(pumStyles, "B5") || "394",
        reason_c: pick(pumStyles, "C5") || "411", reason_d: pick(pumStyles, "D5") || "412",
      };
      const payload = {
        monthSheet: targetSheetForStyle,
        mon: { reasonCell: "C8", styles: S_MON },
        pum: { reasonCell: "C5", styles: S_PUM },
        laws: lawsPayload,
      };
      await appendLaw(zip, payload);
      outLabel = targetSheetForStyle;
    }

    const verify = await verifyPreservation(bytes, zip);
    const vBox = el("div", { class: "verify-box" }, []);
    vBox.appendChild(el("div", { class: "subtitle", text: "원본 보존 검증" }));
    vBox.appendChild(el("p", { text: `삭제된 파트: ${verify.deleted.length}개 ${verify.deleted.length ? "(" + verify.deleted.join(", ") + ")" : ""}` }));
    vBox.appendChild(el("p", { text: `변경된 파트: ${verify.changed.length}개 (${verify.changed.join(", ")})` }));
    vBox.appendChild(el("p", { text: `도형(drawing) 유지: ${verify.drawingsKept ? "OK" : "손실!"}` }));
    if (verify.deleted.length || !verify.drawingsKept) {
      vBox.appendChild(el("p", { class: "err", text: "⚠ 원본이 손상되었을 수 있습니다. 결과 파일을 열기 전에 꼭 확인하세요." }));
    } else if (verify.changed.length > 4) {
      vBox.appendChild(el("p", { class: "warn", text: `변경된 파트가 예상(4개 이하)보다 많습니다.` }));
    } else {
      vBox.appendChild(el("p", { class: "ok", text: "정상 — 도형 100% 유지, 변경 파트도 예상 범위 내." }));
    }
    resultBox.appendChild(vBox);

    const blob = await zip.generateAsync({ type: "blob" });
    const filename = `통합보고서_${outLabel}.xlsx`;
    const dlBtn = el("button", { class: "btn-primary", type: "button", text: "⬇️ 결과 엑셀 다운로드" }, []);
    dlBtn.addEventListener("click", () => downloadBlob(blob, filename));
    resultBox.appendChild(dlBtn);
    toast("엑셀 생성 완료", "ok");
  } catch (err) {
    console.error(err);
    resultBox.appendChild(el("p", { class: "err", text: "생성 실패: " + err.message }));
    toast("생성 실패: " + err.message, "err");
  }
}

/* ============================================================
   PPT 탭
   ============================================================ */
function initPptTab() {
  renderListInputs("#summary-items", state.ppt.items, "요약 항목", 5, () => state.ppt.items.push(""));
  renderTableRows("#changes-rows", state.ppt.changes, ["구분", "종전", "개정"]);
  renderTableRows("#timeline-rows", state.ppt.timeline, ["일자", "구분", "내용"]);
  renderListInputs("#opinion-lines", state.ppt.opinion, "의견", 3, () => state.ppt.opinion.push(""));

  $("#add-summary-item").addEventListener("click", () => {
    if (state.ppt.items.length < 5) { state.ppt.items.push(""); renderListInputs("#summary-items", state.ppt.items, "요약 항목", 5); }
  });
  $("#add-changes-row").addEventListener("click", () => { state.ppt.changes.push(["", "", ""]); renderTableRows("#changes-rows", state.ppt.changes, ["구분", "종전", "개정"]); });
  $("#add-timeline-row").addEventListener("click", () => { state.ppt.timeline.push(["", "", ""]); renderTableRows("#timeline-rows", state.ppt.timeline, ["일자", "구분", "내용"]); });
  $("#add-opinion").addEventListener("click", () => {
    if (state.ppt.opinion.length < 3) { state.ppt.opinion.push(""); renderListInputs("#opinion-lines", state.ppt.opinion, "의견", 3); }
  });

  $("#use-infographic").addEventListener("change", (e) => { $("#infographic-fields").hidden = !e.target.checked; });
  $("#add-card-btn").addEventListener("click", () => {
    if (state.ppt.infoCards.length < 5) { state.ppt.infoCards.push({ id: uid(), icon: Object.keys(ICONS)[0], title: "", line1: "", line2: "" }); renderCards(); }
  });
  renderCards();

  $("#gen-ppt-btn").addEventListener("click", onGeneratePpt);
  $("#pdf-file").addEventListener("change", onPdfSelected);
  $("#gen-ppt-json-btn").addEventListener("click", onGeneratePptFromJson);
}

async function onPdfSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  $("#pdf-status").textContent = "PDF 읽는 중...";
  try {
    const raw = await extractPdfText(file);
    $("#pdf-raw-text").value = raw;
    $("#pdf-raw-box").hidden = false;

    const parsed = parsePressRelease(raw);
    if (parsed.title) $("#ppt-title").value = parsed.title;
    if (parsed.yearMonth) $("#ppt-yearmonth").value = parsed.yearMonth;
    if (parsed.dateStr) $("#ppt-source").value = `보도자료 배포 ${parsed.dateStr}`;
    if (parsed.bullets.length) {
      state.ppt.items = parsed.bullets.slice(0, 5);
      renderListInputs("#summary-items", state.ppt.items, "요약 항목", 5);
    }
    $("#pdf-status").innerHTML =
      `<span class="ok">추출 완료 — 제목·연월·출처·요약 항목(${parsed.bullets.length}개)을 초안으로 채웠습니다. 아래에서 꼭 확인·수정하세요.` +
      (parsed.bullets.length === 0 ? ' (하이라이트 불릿을 못 찾아 요약은 직접 입력해야 합니다.)' : '') + `</span>`;
  } catch (err) {
    console.error(err);
    $("#pdf-status").innerHTML = `<span class="err">PDF 추출 실패: ${err.message}</span>`;
  }
}

async function onGeneratePptFromJson() {
  const box = $("#ppt-json-result");
  box.innerHTML = "";
  let spec;
  try {
    spec = JSON.parse($("#ppt-json-input").value);
  } catch (err) {
    box.appendChild(el("p", { class: "err", text: "JSON 파싱 오류: " + err.message }));
    return;
  }
  if (!spec.meta) {
    box.appendChild(el("p", { class: "err", text: "spec.json에 meta가 없습니다." }));
    return;
  }
  const isFreeForm = Array.isArray(spec.slides);
  const isFixed = spec.summary && spec.changes && spec.timeline;
  if (!isFreeForm && !isFixed) {
    box.appendChild(el("p", { class: "err", text: "spec.json 형식을 인식할 수 없습니다. slides[](자유구성) 또는 summary/changes/timeline(3장 고정) 구조여야 합니다." }));
    return;
  }
  if (!spec.meta.fileTag) spec.meta.fileTag = "press";
  try {
    const blob = isFreeForm ? await buildReportPpt(spec) : await buildPressPpt(spec);
    const filename = (spec.meta.fileTag || "press") + "_영업계획팀.pptx";
    const dlBtn = el("button", { class: "btn-primary", type: "button", text: "⬇️ 결과 PPT 다운로드" }, []);
    dlBtn.addEventListener("click", () => downloadBlob(blob, filename));
    box.appendChild(el("p", { class: "ok", text: "PPT 생성 완료." }));
    box.appendChild(dlBtn);
    toast("PPT 생성 완료", "ok");
  } catch (err) {
    console.error(err);
    box.appendChild(el("p", { class: "err", text: "생성 실패: " + err.message }));
    toast("생성 실패: " + err.message, "err");
  }
}

function renderListInputs(sel, arr, label, max, onAdd) {
  const box = $(sel);
  box.innerHTML = "";
  arr.forEach((val, i) => {
    const ta = el("textarea", { rows: "2", placeholder: `${label} ${i + 1}` }, []);
    ta.value = val;
    ta.addEventListener("input", (e) => { arr[i] = e.target.value; });
    const delBtn = el("button", { class: "btn-icon", type: "button", text: "🗑" }, []);
    delBtn.addEventListener("click", () => { if (arr.length > 1) { arr.splice(i, 1); renderListInputs(sel, arr, label, max); } });
    box.appendChild(el("div", { class: "list-item" }, [ta, delBtn]));
  });
}

function renderTableRows(sel, rows, colLabels) {
  const box = $(sel);
  box.innerHTML = "";
  rows.forEach((row, ri) => {
    const inputs = row.map((val, ci) => {
      const t = el("textarea", { rows: ci === row.length - 1 ? "2" : "1", placeholder: colLabels[ci] }, []);
      t.value = val;
      t.addEventListener("input", (e) => { row[ci] = e.target.value; });
      return t;
    });
    const delBtn = el("button", { class: "btn-icon", type: "button", text: "🗑" }, []);
    delBtn.addEventListener("click", () => { if (rows.length > 1) { rows.splice(ri, 1); renderTableRows(sel, rows, colLabels); } });
    box.appendChild(el("div", { class: "table-row-item" }, [...inputs, delBtn]));
  });
}

function renderCards() {
  const box = $("#info-cards");
  box.innerHTML = "";
  state.ppt.infoCards.forEach((card, ci) => {
    const iconSel = el("select", {}, Object.keys(ICONS).map((k) => el("option", { value: k, text: k })));
    iconSel.value = card.icon;
    iconSel.addEventListener("change", (e) => { card.icon = e.target.value; });
    const titleInput = el("input", { type: "text", placeholder: "카드 제목", value: card.title });
    titleInput.addEventListener("input", (e) => { card.title = e.target.value; });
    const l1 = el("input", { type: "text", placeholder: "줄1", value: card.line1 });
    l1.addEventListener("input", (e) => { card.line1 = e.target.value; });
    const l2 = el("input", { type: "text", placeholder: "줄2", value: card.line2 });
    l2.addEventListener("input", (e) => { card.line2 = e.target.value; });
    const delBtn = el("button", { class: "btn-icon", type: "button", text: "🗑" }, []);
    delBtn.addEventListener("click", () => { state.ppt.infoCards.splice(ci, 1); renderCards(); });
    box.appendChild(el("div", { class: "card-row" }, [iconSel, titleInput, l1, l2, delBtn]));
  });
}

async function onGeneratePpt() {
  const resultBox = $("#ppt-result");
  resultBox.innerHTML = "";
  const title = $("#ppt-title").value.trim();
  if (!title) { toast("제목은 필수입니다.", "err"); return; }

  const spec = {
    meta: {
      title, source: $("#ppt-source").value.trim(), yearMonth: $("#ppt-yearmonth").value.trim(),
      team: $("#ppt-team").value.trim() || "영업부", fileTag: "press",
    },
    summary: { heading: "1. 내용요약", items: state.ppt.items.filter((x) => x.trim()) },
    changes: { heading: "2. 변경사항", columns: [$("#chg-col-a").value, $("#chg-col-b").value, $("#chg-col-c").value], rows: state.ppt.changes.filter((r) => r.some((c) => c.trim())) },
    timeline: { heading: "3. 관련 정책 흐름", columns: ["일자", "구분", "내용"], rows: state.ppt.timeline.filter((r) => r.some((c) => c.trim())) },
    opinion: state.ppt.opinion.filter((x) => x.trim()),
  };
  if ($("#use-infographic").checked) {
    spec.infographic = {
      heading: "4. 종합정리",
      before: { label: $("#info-before-label").value, value: $("#info-before-value").value, caption: $("#info-before-caption").value },
      after: { label: $("#info-after-label").value, value: $("#info-after-value").value, caption: $("#info-after-caption").value },
      cards: state.ppt.infoCards.map((c) => ({ icon: c.icon, title: c.title, lines: [c.line1, c.line2].filter(Boolean) })),
    };
  }

  try {
    const blob = await buildPressPpt(spec);
    const filename = (spec.meta.fileTag || "press") + "_영업계획팀.pptx";
    const dlBtn = el("button", { class: "btn-primary", type: "button", text: "⬇️ 결과 PPT 다운로드" }, []);
    dlBtn.addEventListener("click", () => downloadBlob(blob, filename));
    resultBox.appendChild(el("p", { class: "ok", text: "PPT 생성 완료." }));
    resultBox.appendChild(dlBtn);
    toast("PPT 생성 완료", "ok");
  } catch (err) {
    console.error(err);
    resultBox.appendChild(el("p", { class: "err", text: "생성 실패: " + err.message }));
    toast("생성 실패: " + err.message, "err");
  }
}

/* ============================================================
   init
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initExcelTab();
  initPptTab();
});
