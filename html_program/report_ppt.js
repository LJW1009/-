/* ============================================================
   PPT(자유구성) — build_report_ppt.js 이식
   spec.slides[].blocks[] 자유 구성. box/table/info/itemhead/
   compare/images/note/bar 블록 지원 (images는 파일 경로 대신
   dataUri를 받는다).
   ============================================================ */
"use strict";

const RPT_T = {
  W: 10.8333, H: 7.5,
  FONT: "나눔바른고딕",
  NAVY: "003366", TBL_HEAD: "002060",
  BOX: "FFFFCC", BAR: "FFFF99",
  BLUE: "0000FF", MARK: "FFFF00",
  TEXT: "1F1F1F", LINE: "BFBFBF",
};
const RPT_M = { x: 0.14, w: 10.472, top: 0.157, headH: 0.337, gap: 0.22 };

function buildReportPpt(spec) {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "DETRE", width: RPT_T.W, height: RPT_T.H });
  pres.layout = "DETRE";
  pres.author = "영업계획팀";
  pres.title = spec.meta.title;

  function heading(slide, text, y) {
    slide.addText(text, { x: RPT_M.x, y: y, w: RPT_M.w, h: RPT_M.headH, fontFace: RPT_T.FONT, fontSize: 14, bold: true, color: RPT_T.TEXT, margin: 0, valign: "middle" });
    return y + RPT_M.headH + 0.08;
  }

  function cover(slide) {
    slide.background = { color: "FFFFFF" };
    slide.addText(spec.meta.title, {
      shape: pres.ShapeType.roundRect, rectRadius: 0.174, x: 0.601, y: 0.857, w: 9.63, h: 1.043,
      fill: { color: RPT_T.NAVY }, line: { color: "FFFFFF", width: 3 },
      shadow: { type: "outer", color: "808080", opacity: 0.5, blur: 8, offset: 3, angle: 45 },
      fontFace: RPT_T.FONT, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle",
    });
    if (spec.meta.subtitle) {
      slide.addText(spec.meta.subtitle, { x: 0.601, y: 1.94, w: 9.63, h: 0.32, fontFace: RPT_T.FONT, fontSize: 12, bold: true, color: "595959", align: "center", valign: "middle", margin: 0 });
    }
    if (LOGO_DATA) slide.addImage({ data: LOGO_DATA, x: 3.766, y: 2.44, w: 3.299, h: 2.941 });
    slide.addText(
      [{ text: spec.meta.yearMonth, options: { breakLine: true } }, { text: spec.meta.team, options: {} }],
      { x: 2.964, y: 5.7, w: 4.497, h: 1.043, fontFace: RPT_T.FONT, fontSize: 28, bold: true, color: RPT_T.TEXT, align: "center", valign: "top" }
    );
    slide.addText(spec.meta.source, { x: 0, y: 7.087, w: 8.6, h: 0.3, fontFace: RPT_T.FONT, fontSize: 12, bold: true, color: RPT_T.TEXT, valign: "middle" });
  }

  function renderBox(slide, b, y) {
    if (b.heading) y = heading(slide, b.heading, y);
    const MARKS = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑"];
    const PT = b.fontSize || 11, LH = (PT * 1.5) / 72;
    const n = b.items.reduce((a, t) => a + pptEstLines("➊ " + t, RPT_M.w, PT, 0.26), 0);
    const h = n * LH + 0.3;
    slide.addShape(pres.ShapeType.rect, { x: RPT_M.x - 0.067, y: y, w: RPT_M.w, h: h, fill: { color: RPT_T.BOX }, line: { color: RPT_T.BOX, width: 0.5 } });
    const body = [];
    b.items.forEach((t, i) => {
      body.push({ text: (MARKS[i] || "▪") + " ", options: {} });
      const r = pptRuns(t);
      if (i !== b.items.length - 1) r[r.length - 1].options.breakLine = true;
      body.push.apply(body, r);
    });
    slide.addText(body, { x: RPT_M.x, y: y - 0.106, w: RPT_M.w, h: h + 0.135, fontFace: RPT_T.FONT, fontSize: PT, bold: true, color: RPT_T.TEXT, lineSpacingMultiple: 1.5, valign: "top", margin: [8, 8, 2, 2] });
    return y + h + RPT_M.gap;
  }

  function renderTable(slide, b, y, bottomLimit) {
    if (b.heading) y = heading(slide, b.heading, y);
    const cw = b.colWidths || Array(b.columns.length).fill(RPT_M.w / b.columns.length);
    const head = b.columns.map((c) => ({ text: c, options: { fill: { color: RPT_T.TBL_HEAD }, color: "FFFFFF", bold: true, align: "center", valign: "middle" } }));
    const body = b.rows.map((r) => r.map((cell, ci) => ({ text: pptRuns(cell, { bold: true, color: RPT_T.TEXT }), options: { align: ci === 0 ? "center" : "left", valign: "middle" } })));
    const avail = bottomLimit - y - 0.1;
    let pt = b.fontSize || 10, rowHs, need;
    for (;;) {
      const lh = (pt * 1.34) / 72;
      rowHs = b.rows.map((r) => {
        const n = Math.max.apply(null, r.map((c, i) => pptEstLines(c, cw[i], pt, 0.19)));
        return Math.max(0.3, n * lh + 0.13);
      });
      need = rowHs.reduce((a, c) => a + c, 0.26);
      if (need <= avail || pt <= 8) break;
      pt -= 0.5;
    }
    if (need < avail && b.grow !== false) {
      const extra = Math.min((avail - need) / b.rows.length, 0.52);
      rowHs = rowHs.map((h) => h + extra);
      need += extra * b.rows.length;
    }
    slide.addTable([head].concat(body), { x: RPT_M.x, y: y, w: RPT_M.w, colW: cw, rowH: [0.26].concat(rowHs), border: { type: "solid", color: RPT_T.LINE, pt: 0.75 }, fontFace: RPT_T.FONT, fontSize: pt, margin: [2, 7, 2, 7], autoPage: false });
    return y + need + RPT_M.gap;
  }

  function renderInfo(slide, b, y, bottomLimit) {
    if (b.heading) y = heading(slide, b.heading, y);
    const avail = bottomLimit - y - 0.1;
    const cards = b.cards || [];
    const lowerH = cards.length ? Math.min(1.34, avail * 0.46) : 0;
    const gap = cards.length ? 0.13 : 0;
    const upperH = avail - lowerH - gap;
    const AW = 0.62, CW = (RPT_M.w - AW - 0.24) / 2;
    [{ d: b.before, x: RPT_M.x, fill: "F0F0F0", fg: RPT_T.TEXT, sub: "595959" }, { d: b.after, x: RPT_M.x + CW + AW + 0.24, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" }].forEach((s) => {
      if (!s.d) return;
      slide.addShape(pres.ShapeType.roundRect, { x: s.x, y: y, w: CW, h: upperH, rectRadius: 0.1, fill: { color: s.fill }, line: { color: s.fill, width: 0.5 } });
      slide.addText(s.d.label, { x: s.x, y: y + 0.07, w: CW, h: 0.3, fontFace: RPT_T.FONT, fontSize: 13, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
      slide.addText(s.d.value, { x: s.x, y: y + 0.36, w: CW, h: Math.max(0.36, upperH - 0.92), fontFace: RPT_T.FONT, fontSize: s.d.valueSize || 19, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
      if (s.d.caption) slide.addText(s.d.caption, { x: s.x, y: y + upperH - 0.54, w: CW, h: 0.24, fontFace: RPT_T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
      if (s.d.note) slide.addText(s.d.note, { x: s.x, y: y + upperH - 0.31, w: CW, h: 0.24, fontFace: RPT_T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
    });
    if (b.before && b.after) {
      slide.addShape(pres.ShapeType.rightArrow, { x: RPT_M.x + CW + 0.12, y: y + upperH / 2 - 0.15, w: AW, h: 0.3, fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });
    }
    if (cards.length) {
      const ly = y + upperH + gap;
      slide.addShape(pres.ShapeType.roundRect, { x: RPT_M.x, y: ly, w: RPT_M.w, h: lowerH, rectRadius: 0.1, fill: { color: "FFFFFF" }, line: { color: "D6DCE8", width: 1 } });
      const colW = RPT_M.w / cards.length;
      cards.forEach((c, i) => {
        const cx = RPT_M.x + colW * i;
        const data = ICONS[c.icon || "check"];
        if (data) slide.addImage({ data: data, x: cx + colW / 2 - 0.19, y: ly + 0.11, w: 0.38, h: 0.38 });
        slide.addText(c.title, { x: cx, y: ly + 0.52, w: colW, h: 0.24, fontFace: RPT_T.FONT, fontSize: 11.5, bold: true, color: RPT_T.BLUE, align: "center", valign: "middle", margin: 0 });
        slide.addText((c.lines || []).map((t, k, a) => ({ text: t, options: { breakLine: k !== a.length - 1 } })), { x: cx + 0.04, y: ly + 0.76, w: colW - 0.08, h: lowerH - 0.84, fontFace: RPT_T.FONT, fontSize: 9.5, bold: true, color: RPT_T.TEXT, align: "center", valign: "top", margin: 0, lineSpacingMultiple: 1.12 });
      });
    }
    return y + avail + RPT_M.gap;
  }

  function renderItemHead(slide, b, y) {
    const H = 0.34;
    slide.addShape(pres.ShapeType.roundRect, { x: RPT_M.x, y: y, w: RPT_M.w, h: H, rectRadius: 0.05, fill: { color: "EDF0F6" }, line: { color: "EDF0F6", width: 0.5 } });
    slide.addShape(pres.ShapeType.ellipse, { x: RPT_M.x + 0.07, y: y + 0.035, w: 0.27, h: 0.27, fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });
    slide.addText(String(b.no), { x: RPT_M.x + 0.07, y: y + 0.035, w: 0.27, h: 0.27, fontFace: RPT_T.FONT, fontSize: 10, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    const runsArr = [];
    if (b.tag) runsArr.push({ text: "[" + b.tag + "] ", options: { color: RPT_T.BLUE } });
    runsArr.push.apply(runsArr, pptRuns(b.title, { color: "1F3864" }));
    slide.addText(runsArr, { x: RPT_M.x + 0.44, y: y, w: RPT_M.w - 0.5, h: H, fontFace: RPT_T.FONT, fontSize: 11.5, bold: true, color: "1F3864", align: "left", valign: "middle", margin: 0 });
    return y + H + 0.08;
  }

  function renderCompare(slide, b, y) {
    const H = b.height || 0.74;
    const AW = 0.52, CW = (RPT_M.w - AW - 0.22) / 2;
    [{ d: b.left, x: RPT_M.x, fill: "F0F0F0", fg: RPT_T.TEXT, sub: "595959" }, { d: b.right, x: RPT_M.x + CW + AW + 0.22, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" }].forEach((s) => {
      slide.addShape(pres.ShapeType.roundRect, { x: s.x, y: y, w: CW, h: H, rectRadius: 0.07, fill: { color: s.fill }, line: { color: s.fill, width: 0.5 } });
      slide.addText(s.d.label, { x: s.x, y: y + 0.05, w: CW, h: 0.19, fontFace: RPT_T.FONT, fontSize: 9.5, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
      slide.addText(pptRuns(s.d.value, { color: s.fg }), { x: s.x + 0.08, y: y + 0.25, w: CW - 0.16, h: H - 0.3, fontFace: RPT_T.FONT, fontSize: s.d.size || 12.5, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
    });
    slide.addShape(pres.ShapeType.rightArrow, { x: RPT_M.x + CW + 0.11, y: y + H / 2 - 0.13, w: AW, h: 0.26, fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });
    return y + H + 0.16;
  }

  /** images 블록: 파일 경로 대신 it.dataUri(base64)를 받는다. */
  function renderImages(slide, b, y, bottomLimit) {
    if (b.heading) y = heading(slide, b.heading, y);
    const items = (b.items || []).filter((it) => it.dataUri && it.width && it.height);
    if (!items.length) return y;
    const gap = b.gap === undefined ? 0.18 : b.gap;
    const avail = bottomLimit - y - 0.08;
    const colW = (RPT_M.w - gap * (items.length - 1)) / items.length;
    let maxH = 0;
    items.forEach((it, i) => {
      let w = colW, h = (colW * it.height) / it.width;
      if (h > avail) { h = avail; w = (h * it.width) / it.height; }
      const x = RPT_M.x + (colW + gap) * i + (colW - w) / 2;
      slide.addImage({ data: it.dataUri, x: x, y: y, w: w, h: h });
      if (h > maxH) maxH = h;
    });
    return y + maxH + 0.12;
  }

  function renderNote(slide, b, y) {
    const PT = b.fontSize || 8.5;
    const n = pptEstLines(b.text, RPT_M.w, PT, 0.1);
    const h = (n * PT * 1.45) / 72 + 0.04;
    slide.addText(pptRuns(b.text, { bold: false, color: "595959" }), { x: RPT_M.x + 0.02, y: y, w: RPT_M.w, h: h, fontFace: RPT_T.FONT, fontSize: PT, color: "595959", align: "left", valign: "top", margin: 0 });
    return y + h + 0.1;
  }

  function renderBar(slide, lines) {
    const PT = 11, LH = (PT * 1.35) / 72;
    const n = lines.reduce((a, t) => a + pptEstLines("- " + t, RPT_T.W - 0.9, PT, 0.1), 0);
    const h = Math.max(0.68, n * LH + 0.22);
    const y = RPT_T.H - h - 0.06;
    slide.addShape(pres.ShapeType.rect, { x: 0, y: y, w: RPT_T.W, h: h, fill: { color: RPT_T.BAR }, line: { color: RPT_T.BAR, width: 0.5 } });
    const rr = [];
    lines.forEach((t, i) => {
      const r = pptRuns("- " + t, { bold: true, color: RPT_T.TEXT });
      if (i !== lines.length - 1) r[r.length - 1].options.breakLine = true;
      rr.push.apply(rr, r);
    });
    slide.addText(rr, { x: 0.25, y: y, w: RPT_T.W - 0.5, h: h, fontFace: RPT_T.FONT, fontSize: PT, bold: true, color: RPT_T.TEXT, align: "left", valign: "middle", margin: 0 });
    return y;
  }

  cover(pres.addSlide());
  (spec.slides || []).forEach((sl) => {
    const slide = pres.addSlide();
    slide.background = { color: "FFFFFF" };
    const blocks = sl.blocks || [];
    const bar = blocks.filter((b) => b.type === "bar")[0];
    const bottom = bar ? renderBar(slide, bar.lines) - 0.14 : RPT_T.H - 0.22;

    const flow = blocks.filter((b) => b.type !== "bar");
    const FIXED = { note: 1, itemhead: 1, compare: 1 };
    const nFlex = flow.filter((b) => !FIXED[b.type]).length;
    let flexSeen = 0;
    let y = RPT_M.top;
    flow.forEach((b) => {
      if (!FIXED[b.type]) flexSeen += 1;
      const isLast = flexSeen === nFlex;
      const limit = bottom;
      if (b.type === "note") { y = renderNote(slide, b, y); return; }
      if (b.type === "itemhead") { y = renderItemHead(slide, b, y); return; }
      if (b.type === "compare") { y = renderCompare(slide, b, y); return; }
      if (b.type === "box") y = renderBox(slide, b, y);
      else if (b.type === "table") y = renderTable(slide, b, y, b.maxBottom || (isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || 1 / Math.max(1, nFlex - flexSeen + 1)))));
      else if (b.type === "images") y = renderImages(slide, b, y, isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || 1 / Math.max(1, nFlex - flexSeen + 1))));
      else if (b.type === "info") y = renderInfo(slide, b, y, isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || 1 / Math.max(1, nFlex - flexSeen + 1))));
    });
  });

  return pres.write({ outputType: "blob" });
}
