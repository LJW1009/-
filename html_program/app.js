/* ============================================================
   법규 최신화 프로그램 — 브라우저 전용 (Python/Node 불필요)
   detre_flow/scripts/build_legal_sheet.py, append_law.py,
   build_press_ppt.js 의 로직을 그대로 이식한 버전.
   ============================================================ */
"use strict";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DEFAULT_DEPT = "영업계획팀";

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function el(tag, attrs, children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children || []) e.appendChild(c);
  return e;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function toast(msg, kind) {
  const box = $("#toast-box");
  const t = el("div", { class: "toast " + (kind || "") }, []);
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 5000);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ============================================================
   공통: XML 유틸
   ============================================================ */
function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("XML 파싱 오류: " + err.textContent.slice(0, 200));
  return doc;
}
function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function estLines(text, width, pt) {
  if (!text) return 1;
  const per = Math.max(4.0, (width * 11.0) / (2.0 * pt));
  let n = 0;
  for (const seg of String(text).split("\n")) {
    let cjk = 0;
    for (const ch of seg) if (ch.codePointAt(0) > 0x2e00) cjk++;
    const w = cjk + (seg.length - cjk) * 0.5;
    n += Math.max(1, Math.ceil(w / per));
  }
  return n;
}
async function readZipText(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  return await f.async("string");
}
function localName(elm) { return elm.localName; }

/* ============================================================
   EXCEL — build_legal_sheet.py / append_law.py 이식
   ============================================================ */
const W_MON = { C: 94.125, D: 96.375 };
const W_PUM = { C: 35.75, D: 35.75 };

function xCell(ref, style, text) {
  if (text === undefined || text === null) return `<c r="${ref}" s="${style}"/>`;
  const body = xmlEscape(String(text)).replace(/\n/g, "&#10;");
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${body}</t></is></c>`;
}
function xRow(idx, height, cells) {
  return `<row r="${idx}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
}

async function listSheets(zip) {
  const wbXml = await readZipText(zip, "xl/workbook.xml");
  const doc = parseXml(wbXml);
  return Array.from(doc.getElementsByTagNameNS(NS_MAIN, "sheet")).map((e) => e.getAttribute("name"));
}
function monthTabs(sheets, dept) {
  const pat = new RegExp("^(\\d{4})\\.(\\d{2}) " + escapeRegex(dept || DEFAULT_DEPT));
  const found = [];
  for (const s of sheets) {
    const m = s.match(pat);
    if (m) found.push([s, m[1] + "-" + m[2]]);
  }
  found.sort((a, b) => b[1].localeCompare(a[1]));
  return found;
}
async function findSheetPath(zip, sheetName) {
  const wb = await readZipText(zip, "xl/workbook.xml");
  const rels = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  const m = wb.match(new RegExp('<sheet name="' + escapeRegex(sheetName) + '"[^>]*r:id="(rId\\d+)"'));
  if (!m) return null;
  const rid = m[1];
  const m2 = rels.match(new RegExp('Id="' + rid + '"[^>]*Target="([^"]+)"'));
  if (!m2) return null;
  return "xl/" + m2[1].replace(/^\//, "");
}
/** 행 번호 → {셀좌표: 스타일인덱스}, DOMParser 기반 (자기종료 <row/> 도 정확히 처리) */
async function extractCellStyles(zip, sheetPath) {
  const xml = await readZipText(zip, sheetPath);
  if (!xml) return null;
  const doc = parseXml(xml);
  const out = {};
  for (const row of doc.getElementsByTagNameNS(NS_MAIN, "row")) {
    const rn = parseInt(row.getAttribute("r"), 10);
    const cells = {};
    for (const c of row.getElementsByTagNameNS(NS_MAIN, "c")) {
      const s = c.getAttribute("s");
      if (s !== null) cells[c.getAttribute("r")] = s;
    }
    out[rn] = cells;
  }
  return out;
}
function pickStyle(styleMap, ref) {
  const rn = parseInt(ref.match(/\d+/)[0], 10);
  return (styleMap && styleMap[rn] && styleMap[rn][ref]) || null;
}
async function readStylesInfo(zip) {
  const xml = await readZipText(zip, "xl/styles.xml");
  const doc = parseXml(xml);
  const fontsEl = doc.getElementsByTagNameNS(NS_MAIN, "fonts")[0];
  const fonts = Array.from(fontsEl.children).map((f) => {
    const children = Array.from(f.children);
    const colorEl = children.find((e) => localName(e) === "color");
    const bold = children.some((e) => localName(e) === "b");
    const szEl = children.find((e) => localName(e) === "sz");
    return { rgb: colorEl ? colorEl.getAttribute("rgb") : null, bold, sz: szEl ? szEl.getAttribute("val") : null };
  });
  const cellXfs = Array.from(doc.getElementsByTagNameNS(NS_MAIN, "cellXfs")[0].children);
  return { fonts, cellXfs };
}
function fontSignature(stylesInfo, styleIdx) {
  if (!styleIdx) return null;
  const idx = parseInt(styleIdx, 10);
  if (idx >= stylesInfo.cellXfs.length) return null;
  const fid = parseInt(stylesInfo.cellXfs[idx].getAttribute("fontId") || "0", 10);
  return stylesInfo.fonts[fid] || null;
}

function buildMonthSheet(payload, year, month, dept, S) {
  const rows = [], merges = [];
  const ht = (n, pt) => Math.round(Math.max(15.0, n * (pt || 12.1) * 1.32) * 10) / 10;

  rows.push(xRow(1, 15, []));
  rows.push(xRow(2, 30, [
    xCell("A2", S.title, `${year}년 ${month}월 각 부서별 중요 행정절차 및 법규 변경사항`),
    xCell("B2", S.title_c), xCell("C2", S.title_c), xCell("D2", S.title_c),
  ]));
  merges.push("A2:D2");
  rows.push(xRow(3, 15, []));
  rows.push(xRow(4, 16.15, [
    xCell("A4", S.h_a1, "통보부서"), xCell("B4", S.h_b1, "법률명칭"),
    xCell("C4", S.h_c1), xCell("D4", S.h_c1),
  ]));
  rows.push(xRow(5, 16.15, [
    xCell("A5", S.h_a2), xCell("B5", S.h_b2),
    xCell("C5", S.h_c2, "변경전"), xCell("D5", S.h_c2, "변경 후"),
  ]));
  merges.push("A4:A5", "B4:B5");

  if (payload.noChanges) {
    rows.push(xRow(6, 46.2, [
      xCell("A6", S.dept, dept),
      xCell("B6", S.law, `${String(year).slice(2)}년 ${month}월 법규 변경사항 없음`),
      xCell("C6", S.law), xCell("D6", S.law),
    ]));
    merges.push("B6:D6");
    return { rows, merges, last: 6 };
  }

  const first = 6;
  let r = first;
  for (const law of payload.laws) {
    const start = r;
    for (const item of law.rows || []) {
      const k = item.kind || "same";
      const sc = { head: S.head_c, same: S.same_c, change: S.chg_c }[k];
      const sd = { head: S.head_d, same: S.same_d, change: S.chg_d }[k];
      const n = Math.max(estLines(item.before, W_MON.C, 12.1), estLines(item.after, W_MON.D, 12.1));
      const title = r === start ? law.name + (law.enforcement ? "\n" + law.enforcement : "") : null;
      rows.push(xRow(r, ht(n), [
        xCell(`A${r}`, S.dept, r === first ? dept : null),
        xCell(`B${r}`, S.law, title),
        xCell(`C${r}`, sc, item.before),
        xCell(`D${r}`, sd, item.after),
      ]));
      r++;
    }
    if (r - 1 > start) merges.push(`B${start}:B${r - 1}`);

    const blk = r;
    if (law.reason) {
      const n = estLines(law.reason, W_MON.C + W_MON.D, 12.0);
      rows.push(xRow(r, ht(n, 12.0), [
        xCell(`A${r}`, S.dept), xCell(`B${r}`, S.reason_lbl, "개정이유"),
        xCell(`C${r}`, S.reason_c, law.reason), xCell(`D${r}`, S.reason_d),
      ]));
      merges.push(`C${r}:D${r}`);
      r++;
    }
    if (law.impact) {
      rows.push(xRow(r, 31.7, [
        xCell(`A${r}`, S.dept), xCell(`B${r}`, S.reason_lbl),
        xCell(`C${r}`, S.impact_c, law.impact), xCell(`D${r}`, S.impact_d),
      ]));
      merges.push(`C${r}:D${r}`);
      r++;
    }
    if (r - 1 > blk) merges.push(`B${blk}:B${r - 1}`);
  }
  const last = r - 1;
  if (last > first) merges.push(`A${first}:A${last}`);
  return { rows, merges, last };
}

function buildPumSheet(payload, S) {
  const rows = [], merges = [];
  const ht = (n) => Math.round(Math.max(9.4, n * 9.3) * 100) / 100;

  rows.push(xRow(1, 8.45, []));
  rows.push(xRow(2, 18, [xCell("B2", S.hdr, "구분"), xCell("C2", S.hdr, "현행"), xCell("D2", S.hdr, "개선")]));

  if (payload.noChanges) {
    const [y, m] = payload.yearMonth.split("-");
    rows.push(xRow(3, 20, [
      xCell("B3", S.law, `${y.slice(2)}년 ${m.padStart(2, "0")}월 법규 변경사항 없음`),
      xCell("C3", S.same_c), xCell("D3", S.same_d),
    ]));
    merges.push("C3:D3");
    return { rows, merges, last: 3 };
  }

  let r = 3;
  for (const law of payload.laws) {
    const start = r;
    for (const item of law.rows || []) {
      const k = item.kind || "same";
      const sc = { head: S.head_c, same: S.same_c, change: S.chg_c }[k];
      const sd = { head: S.head_d, same: S.same_d, change: S.chg_d }[k];
      const n = Math.max(estLines(item.before, W_PUM.C, 6.0), estLines(item.after, W_PUM.D, 6.0));
      const title = r === start ? law.name + (law.enforcement ? "\n" + law.enforcement : "") : null;
      rows.push(xRow(r, ht(n), [xCell(`B${r}`, S.law, title), xCell(`C${r}`, sc, item.before), xCell(`D${r}`, sd, item.after)]));
      r++;
    }
    if (r - 1 > start) merges.push(`B${start}:B${r - 1}`);

    const blk = r;
    if (law.reason) {
      const n = estLines(law.reason, W_PUM.C + W_PUM.D, 6.0);
      rows.push(xRow(r, ht(n), [xCell(`B${r}`, S.reason_lbl, "개정이유"), xCell(`C${r}`, S.reason_c, law.reason), xCell(`D${r}`, S.reason_d)]));
      merges.push(`C${r}:D${r}`);
      r++;
    }
    if (law.impact) {
      rows.push(xRow(r, 18.6, [xCell(`B${r}`, S.reason_lbl), xCell(`C${r}`, S.impact_c, law.impact), xCell(`D${r}`, S.impact_d)]));
      merges.push(`C${r}:D${r}`);
      r++;
    }
    if (r - 1 > blk) merges.push(`B${blk}:B${r - 1}`);
  }
  return { rows, merges, last: r - 1 };
}

const COLS_MON =
  '<cols><col min="1" max="1" width="17.25" customWidth="1"/><col min="2" max="2" width="31.75" customWidth="1"/>' +
  '<col min="3" max="3" width="94.125" customWidth="1"/><col min="4" max="4" width="96.375" customWidth="1"/></cols>';
const COLS_PUM =
  '<cols><col min="1" max="1" width="2.25" customWidth="1"/><col min="2" max="2" width="10.25" customWidth="1"/>' +
  '<col min="3" max="4" width="35.75" customWidth="1"/><col min="5" max="5" width="6.875" customWidth="1"/></cols>';

function sheetXml(dim, cols, rows, merges, rid, scale, fitH) {
  let mc = "";
  if (merges.length) mc = `<mergeCells count="${merges.length}">` + merges.map((m) => `<mergeCell ref="${m}"/>`).join("") + `</mergeCells>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultColWidth="9" defaultRowHeight="8.4"/>` +
    `${cols}<sheetData>${rows.join("")}</sheetData>${mc}` +
    `<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="8" scale="${scale}" fitToHeight="${fitH || 0}" orientation="landscape" r:id="${rid}"/>` +
    `</worksheet>`
  );
}

async function buildLegalSheetNewMonth(zip, payload) {
  const [year, monthRaw] = payload.yearMonth.split("-");
  const month = monthRaw.padStart(2, "0");
  const dept = payload.department || DEFAULT_DEPT;
  const sheetName = `${year}.${month} ${dept}`;

  let wb = await readZipText(zip, "xl/workbook.xml");
  let rels = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  let ct = await readZipText(zip, "[Content_Types].xml");

  if (wb.includes(`name="${sheetName}"`)) throw new Error(`[${sheetName}] 시트가 이미 있습니다.`);

  const usedNums = Array.from(rels.matchAll(/worksheets\/sheet(\d+)\.xml/g)).map((m) => parseInt(m[1], 10));
  const newNo = Math.max(...usedNums) + 1;
  const newTarget = `worksheets/sheet${newNo}.xml`;
  const ridNums = Array.from(rels.matchAll(/Id="rId(\d+)"/g)).map((m) => parseInt(m[1], 10));
  const newRid = "rId" + (Math.max(...ridNums) + 1);
  const sidNums = Array.from(wb.matchAll(/sheetId="(\d+)"/g)).map((m) => parseInt(m[1], 10));
  const newSid = Math.max(...sidNums) + 1;

  const pumRidM = wb.match(/<sheet name="품의용 갑지"[^>]*r:id="(rId\d+)"/);
  if (!pumRidM) throw new Error("'품의용 갑지' 시트를 찾을 수 없습니다.");
  const pumRid = pumRidM[1];
  const pumTargetM = rels.match(new RegExp(`Id="${pumRid}"[^>]*Target="([^"]+)"`));
  const pumTarget = pumTargetM[1];
  const pumPath = "xl/" + pumTarget.replace(/^\//, "");

  const pumXmlOrig = await readZipText(zip, pumPath);
  const tail = pumXmlOrig.split("<pageSetup").pop();
  const pumPridM = tail.match(/r:id="(rId\d+)"/);
  const pumPrid = pumPridM ? pumPridM[1] : "rId1";

  const mResult = buildMonthSheet(payload, year, month, dept, payload.styles.mon);
  const pResult = buildPumSheet(payload, payload.styles.pum);
  const monthXml = sheetXml(`A1:D${mResult.last}`, COLS_MON, mResult.rows, mResult.merges, "rId1", 78);
  const pumXmlNew = sheetXml(`B1:D${pResult.last}`, COLS_PUM, pResult.rows, pResult.merges, pumPrid, 100, 1);

  const newRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings1.bin"/></Relationships>`;

  const anchorM = wb.match(/(<sheet name="품의용 갑지"[^>]*\/>)/);
  const anchor = anchorM[1];
  wb = wb.replace(anchor, anchor + `<sheet name="${sheetName}" sheetId="${newSid}" r:id="${newRid}"/>`);
  rels = rels.replace(
    "</Relationships>",
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${newTarget}"/></Relationships>`
  );
  ct = ct.replace(
    "</Types>",
    `<Override PartName="/xl/${newTarget}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
  );

  zip.file("xl/workbook.xml", wb);
  zip.file("xl/_rels/workbook.xml.rels", rels);
  zip.file("[Content_Types].xml", ct);
  zip.file(pumPath, pumXmlNew);
  zip.file("xl/" + newTarget, monthXml);
  zip.file(`xl/worksheets/_rels/sheet${newNo}.xml.rels`, newRels);

  return { sheetName, monthLast: mResult.last, pumLast: pResult.last };
}

function parseSheetRobust(xml) {
  const doc = parseXml(xml);
  const rows = {};
  for (const row of doc.getElementsByTagNameNS(NS_MAIN, "row")) {
    const rn = parseInt(row.getAttribute("r"), 10);
    const cells = {};
    for (const c of row.getElementsByTagNameNS(NS_MAIN, "c")) {
      const s = c.getAttribute("s");
      if (s !== null) cells[c.getAttribute("r")] = s;
    }
    rows[rn] = cells;
  }
  const merges = Array.from(doc.getElementsByTagNameNS(NS_MAIN, "mergeCell")).map((m) => m.getAttribute("ref"));
  return { rows, merges };
}

async function appendLaw(zip, payload) {
  const wb = await readZipText(zip, "xl/workbook.xml");
  const rels = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  function sheetPathSync(name) {
    const m = wb.match(new RegExp(`<sheet name="${escapeRegex(name)}"[^>]*r:id="(rId\\d+)"`));
    if (!m) throw new Error(`'${name}' 시트를 찾을 수 없습니다.`);
    const m2 = rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"`));
    return "xl/" + m2[1].replace(/^\//, "");
  }
  const monPath = sheetPathSync(payload.monthSheet);
  const pumPath = sheetPathSync("품의용 갑지");

  for (const [path, kind] of [[monPath, "mon"], [pumPath, "pum"]]) {
    let xml = await readZipText(zip, path);
    const { rows, merges } = parseSheetRobust(xml);
    const cfg = payload[kind];
    const W = kind === "mon" ? W_MON : W_PUM;
    const PT = kind === "mon" ? 12.1 : 6.0;
    const LH = kind === "mon" ? 15.95 : 9.3;
    const S = cfg.styles;

    const rowNums = Object.keys(rows).map(Number);
    const last = Math.max(...rowNums);
    let r = last + 1;
    const newRows = [];
    let newMerges = [];

    for (const law of payload.laws) {
      const start = r;
      for (const item of law.rows) {
        const k = item.kind || "same";
        const sc = k === "same" ? S.same_c : S.chg_c;
        const sd = k === "same" ? S.same_d : S.chg_d;
        const n = Math.max(estLines(item.before, W.C, PT), estLines(item.after, W.D, PT));
        const h = Math.round(Math.max(LH, n * LH) * 100) / 100;
        const title = r === start ? law.name + (law.enforcement ? "\n" + law.enforcement : "") : null;
        const cells = [];
        if (kind === "mon") cells.push(xCell(`A${r}`, S.dept));
        cells.push(xCell(`B${r}`, S.law, title), xCell(`C${r}`, sc, item.before), xCell(`D${r}`, sd, item.after));
        newRows.push(xRow(r, h, cells));
        r++;
      }
      if (r - 1 > start) newMerges.push(`B${start}:B${r - 1}`);

      if (law.reason) {
        const n = estLines(law.reason, W.C + W.D, PT);
        const h = Math.round(Math.max(LH, n * LH * 0.99) * 100) / 100;
        const cells = [];
        if (kind === "mon") cells.push(xCell(`A${r}`, S.dept));
        cells.push(xCell(`B${r}`, S.reason_lbl, "개정이유"), xCell(`C${r}`, S.reason_c, law.reason), xCell(`D${r}`, S.reason_d));
        newRows.push(xRow(r, h, cells));
        newMerges.push(`C${r}:D${r}`);
        r++;
      }
    }
    const newLast = r - 1;

    if (payload.updateReason) {
      const tgtRef = cfg.reasonCell;
      const rn = parseInt(tgtRef.match(/\d+/)[0], 10);
      const style = (rows[rn] || {})[tgtRef];
      const re = new RegExp(`<c r="${tgtRef}" s="\\d+"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
      xml = xml.replace(re, xCell(tgtRef, style, payload.updateReason));
      const nl = estLines(payload.updateReason, W.C + W.D, PT);
      const nh = Math.round(Math.max(LH, nl * LH * 0.99) * 100) / 100;
      xml = xml.replace(new RegExp(`(<row r="${rn}")[^>]*?(>)`), `$1 ht="${nh}" customHeight="1"$2`);
    }

    xml = xml.replace("</sheetData>", newRows.join("") + "</sheetData>");

    if (kind === "mon") {
      const oldA = merges.filter((m) => /^A\d+:A\d+$/.test(m));
      if (oldA.length) {
        const tgt = oldA.reduce((best, m) => (parseInt(m.split(":")[0].slice(1)) > parseInt(best.split(":")[0].slice(1)) ? m : best));
        const s0 = parseInt(tgt.split(":")[0].slice(1), 10);
        newMerges.push(`A${s0}:A${newLast}`);
        const idx = merges.indexOf(tgt);
        if (idx >= 0) merges.splice(idx, 1);
        xml = xml.replace(`<mergeCell ref="${tgt}"/>`, "");
      }
    }
    const allM = merges.concat(newMerges);
    xml = xml.replace(
      /<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
      `<mergeCells count="${allM.length}">` + allM.map((m) => `<mergeCell ref="${m}"/>`).join("") + `</mergeCells>`
    );

    if (xml.includes("<pageSetup")) {
      const psM = xml.match(/<pageSetup[^>]*\/>/);
      let newPs = psM[0];
      newPs = newPs.includes("fitToHeight=") ? newPs.replace(/fitToHeight="\d+"/, 'fitToHeight="1"') : newPs.replace("/>", ' fitToHeight="1"/>');
      if (!newPs.includes("fitToWidth=")) newPs = newPs.replace("/>", ' fitToWidth="1"/>');
      newPs = newPs.replace(/\s*scale="\d+"/, "");
      xml = xml.replace(psM[0], newPs);
    }
    if (!xml.includes("<pageSetUpPr")) xml = xml.replace("<sheetPr>", '<sheetPr><pageSetUpPr fitToPage="1"/>');

    const col0 = kind === "mon" ? "A" : "B";
    xml = xml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="${col0}1:D${newLast}"/>`);

    zip.file(path, xml);
  }
}

/** 원본 보존 검증: 삭제된 파트 / 변경된 파트 / 도형 유지 여부 */
async function verifyPreservation(origBytes, outZip) {
  const origZip = await JSZip.loadAsync(origBytes);
  const origNames = Object.keys(origZip.files).filter((n) => !origZip.files[n].dir);
  const outNames = new Set(Object.keys(outZip.files).filter((n) => !outZip.files[n].dir));
  const deleted = origNames.filter((n) => !outNames.has(n));
  const changed = [];
  for (const n of origNames) {
    if (outNames.has(n)) {
      const a = await origZip.files[n].async("uint8array");
      const b = await outZip.files[n].async("uint8array");
      let equal = a.length === b.length;
      if (equal) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { equal = false; break; }
      if (!equal) changed.push(n);
    }
  }
  const drawingsKept = origNames.filter((n) => n.includes("drawing")).every((n) => outNames.has(n));
  return { deleted, changed, drawingsKept };
}
