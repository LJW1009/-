/* ============================================================
   PPT — build_press_ppt.js 이식 (3장 고정 보도자료 요약)
   아이콘/로고는 파일 경로 대신 ICONS/LOGO_DATA(base64)를 사용.
   ============================================================ */
"use strict";

const PPT_T = {
  W: 10.8333, H: 7.5,
  FONT: "나눔바른고딕",
  NAVY: "003366",
  TBL_HEAD: "002060",
  BOX: "FFFFCC",
  BAR: "FFFF99",
  BLUE: "0000FF",
  MARK: "FFFF00",
  TEXT: "1F1F1F",
  LINE: "BFBFBF",
};
const PPT_P = {
  cover: {
    bar: { x: 0.601, y: 0.857, w: 9.63, h: 1.043 },
    logo: { x: 3.766, y: 2.37, w: 3.299, h: 2.941 },
    stamp: { x: 2.964, y: 5.655, w: 4.497, h: 1.043 },
    src: { x: 0.0, y: 7.087, w: 5.48, h: 0.3 },
  },
  s2: {
    h1: { x: 0.18, y: 0.294, w: 5.377, h: 0.337 },
    box: { x: 0.113, y: 0.798, w: 10.47, h: 1.904 },
    text: { x: 0.18, y: 0.692, w: 10.47, h: 2.039 },
    h2y: 3.274, tblY: 3.656, tblPt: 11,
  },
  s3: {
    h3: { x: 0.14, y: 0.157, w: 5.377, h: 0.337 },
    tbl: { x: 0.14, y: 0.573, w: 10.472 },
    colW: [1.416, 4.019, 5.037],
    headH: 0.23, rowH: 0.851,
    bar: { x: 0, y: 6.395, w: 10.8333, h: 1.045 },
    info: { x: 0.14, w: 10.472, gapTop: 0.2, gapBottom: 0.14, headH: 0.3 },
  },
};

function pptRuns(src, base) {
  base = base || {};
  const out = [];
  const lines = String(src).split("\n");
  lines.forEach((line, li) => {
    const re = /(\[\[[^\]]*\]\]|\{\{[^}]*\}\})/g;
    const parts = line.split(re).filter((s) => s !== "");
    if (parts.length === 0) parts.push("");
    parts.forEach((seg, si) => {
      const o = Object.assign({}, base);
      let text = seg;
      if (seg.indexOf("[[") === 0) { text = seg.slice(2, -2); o.color = PPT_T.BLUE; }
      else if (seg.indexOf("{{") === 0) { text = seg.slice(2, -2); o.color = PPT_T.BLUE; o.highlight = PPT_T.MARK; }
      if (si === parts.length - 1 && li !== lines.length - 1) o.breakLine = true;
      out.push({ text: text, options: o });
    });
  });
  return out;
}
const pptPlain = (s) => String(s).replace(/\[\[|\]\]|\{\{|\}\}/g, "");
function pptEmWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[ᄀ-ᇿ　-〿㄰-㆏가-힯＀-￯]/.test(ch) ? 1 : 0.52;
  return w;
}
function pptEstLines(text, widthIn, fontPt, padIn) {
  const usable = Math.max(0.4, widthIn - (padIn === undefined ? 0.2 : padIn));
  const perLine = Math.max(4, (usable * 72) / fontPt);
  let total = 0;
  for (const seg of pptPlain(text).split("\n")) total += Math.max(1, Math.ceil(pptEmWidth(seg) / perLine));
  return total;
}

function buildPressPpt(spec) {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "DETRE", width: PPT_T.W, height: PPT_T.H });
  pres.layout = "DETRE";
  pres.author = "영업계획팀";
  pres.title = spec.meta.title;

  function heading(slide, text, pos) {
    slide.addText(text, Object.assign({}, pos, { fontFace: PPT_T.FONT, fontSize: 14, bold: true, color: PPT_T.TEXT, margin: 0, valign: "middle" }));
  }

  function cover(slide) {
    slide.background = { color: "FFFFFF" };
    slide.addText(spec.meta.title, Object.assign({}, PPT_P.cover.bar, {
      shape: pres.ShapeType.roundRect, rectRadius: 0.174,
      fill: { color: PPT_T.NAVY }, line: { color: "FFFFFF", width: 3 },
      shadow: { type: "outer", color: "808080", opacity: 0.5, blur: 8, offset: 3, angle: 45 },
      fontFace: PPT_T.FONT, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle",
    }));
    if (LOGO_DATA) slide.addImage(Object.assign({ data: LOGO_DATA }, PPT_P.cover.logo));
    slide.addText(
      [{ text: spec.meta.yearMonth, options: { breakLine: true } }, { text: spec.meta.team, options: {} }],
      Object.assign({}, PPT_P.cover.stamp, { fontFace: PPT_T.FONT, fontSize: 28, bold: true, color: PPT_T.TEXT, align: "center", valign: "top" })
    );
    slide.addText(spec.meta.source, Object.assign({}, PPT_P.cover.src, { fontFace: PPT_T.FONT, fontSize: 12, bold: true, color: PPT_T.TEXT, valign: "middle" }));
  }

  function summarySlide(slide) {
    slide.background = { color: "FFFFFF" };
    heading(slide, spec.summary.heading || "1. 내용요약", PPT_P.s2.h1);

    const MARKS = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑"];
    const items = spec.summary.items || [];
    const SUM_PT = 11, SUM_LH = (SUM_PT * 1.5) / 72;
    const nLines = items.reduce((a, t) => a + pptEstLines("➊ " + t, PPT_P.s2.box.w, SUM_PT, 0.26), 0);
    const boxH = Math.max(PPT_P.s2.box.h, nLines * SUM_LH + 0.3);

    slide.addShape(pres.ShapeType.rect, Object.assign({}, PPT_P.s2.box, { h: boxH, fill: { color: PPT_T.BOX }, line: { color: PPT_T.BOX, width: 0.5 } }));

    const body = [];
    items.forEach((t, i) => {
      body.push({ text: (MARKS[i] || "▪") + " ", options: {} });
      const r = pptRuns(t);
      if (i !== items.length - 1) r[r.length - 1].options.breakLine = true;
      body.push.apply(body, r);
    });
    slide.addText(body, Object.assign({}, PPT_P.s2.text, {
      h: boxH + 0.135, fontFace: PPT_T.FONT, fontSize: SUM_PT, bold: true, color: PPT_T.TEXT,
      lineSpacingMultiple: 1.5, valign: "top", margin: [8, 8, 2, 2],
    }));

    const h2y = Math.max(PPT_P.s2.h2y, PPT_P.s2.box.y + boxH + 0.2);
    heading(slide, spec.changes.heading || "2. 변경사항", { x: PPT_P.s2.h1.x, y: h2y, w: PPT_P.s2.h1.w, h: PPT_P.s2.h1.h });

    const tblY = Math.max(PPT_P.s2.tblY, h2y + 0.38);
    const availH = PPT_T.H - tblY - 0.5;

    const cols = spec.changes.columns;
    const rows = spec.changes.rows || [];
    const head = cols.map((c) => ({ text: c, options: { fill: { color: PPT_T.TBL_HEAD }, color: "FFFFFF", bold: true, align: "center", valign: "middle" } }));
    const body2 = rows.map((r) => r.map((cell, ci) => ({ text: pptRuns(cell, { bold: true, color: PPT_T.TEXT }), options: { align: ci === 0 ? "center" : "left", valign: "middle" } })));

    const cw = spec.changes.colWidths || [2.1, 4.1, 4.27];
    let pt = PPT_P.s2.tblPt, rowHs, need;
    for (;;) {
      const lh = (pt * 1.32) / 72;
      rowHs = rows.map((r) => {
        const n = Math.max.apply(null, r.map((c, i) => pptEstLines(c, cw[i], pt, 0.19)));
        return Math.max(0.3, n * lh + 0.12);
      });
      need = rowHs.reduce((a, b) => a + b, 0.26);
      if (need <= availH || pt <= 8.5) break;
      pt -= 0.5;
    }
    if (need < availH) {
      const extra = Math.min((availH - need) / Math.max(1, rows.length), 0.34);
      rowHs = rowHs.map((h) => h + extra);
    }
    slide.addTable([head].concat(body2), {
      x: PPT_P.s2.box.x, y: tblY, w: PPT_P.s2.box.w, colW: cw, rowH: [0.26].concat(rowHs),
      border: { type: "solid", color: PPT_T.LINE, pt: 0.75 }, fontFace: PPT_T.FONT, fontSize: pt, margin: [2, 7, 2, 7], autoPage: false,
    });
  }

  function infographicBlock(slide, top, bottom) {
    const g = spec.infographic;
    if (!g) return;
    const X = PPT_P.s3.info.x, W = PPT_P.s3.info.w;
    let y = top;
    if (g.heading) {
      heading(slide, g.heading, { x: X, y: y, w: 5.377, h: PPT_P.s3.info.headH });
      y += PPT_P.s3.info.headH + 0.06;
    }
    const avail = bottom - y;
    const cards = g.cards || [];
    const lowerH = cards.length ? Math.min(1.34, avail * 0.46) : 0;
    const gap = cards.length ? 0.13 : 0;
    const upperH = avail - lowerH - gap;

    const AW = 0.62, CW = (W - AW - 0.24) / 2;
    const pair = [
      { d: g.before, x: X, fill: "F0F0F0", fg: PPT_T.TEXT, sub: "595959" },
      { d: g.after, x: X + CW + AW + 0.24, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" },
    ];
    pair.forEach((s) => {
      if (!s.d) return;
      slide.addShape(pres.ShapeType.roundRect, { x: s.x, y: y, w: CW, h: upperH, rectRadius: 0.1, fill: { color: s.fill }, line: { color: s.fill, width: 0.5 } });
      slide.addText(s.d.label, { x: s.x, y: y + 0.07, w: CW, h: 0.3, fontFace: PPT_T.FONT, fontSize: 13, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
      slide.addText(s.d.value, { x: s.x, y: y + 0.36, w: CW, h: Math.max(0.36, upperH - 0.92), fontFace: PPT_T.FONT, fontSize: 19, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
      if (s.d.caption) slide.addText(s.d.caption, { x: s.x, y: y + upperH - 0.54, w: CW, h: 0.24, fontFace: PPT_T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
      if (s.d.note) slide.addText(s.d.note, { x: s.x, y: y + upperH - 0.31, w: CW, h: 0.24, fontFace: PPT_T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
    });

    slide.addShape(pres.ShapeType.rightArrow, { x: X + CW + 0.12, y: y + upperH / 2 - 0.15, w: AW, h: 0.3, fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });

    if (!cards.length) return;
    const ly = y + upperH + gap;
    slide.addShape(pres.ShapeType.roundRect, { x: X, y: ly, w: W, h: lowerH, rectRadius: 0.1, fill: { color: "FFFFFF" }, line: { color: "D6DCE8", width: 1 } });
    const n = cards.length, colW = W / n;
    cards.forEach((c, i) => {
      const cx = X + colW * i;
      const data = ICONS[c.icon || "check"];
      if (data) slide.addImage({ data: data, x: cx + colW / 2 - 0.19, y: ly + 0.11, w: 0.38, h: 0.38 });
      slide.addText(c.title, { x: cx, y: ly + 0.52, w: colW, h: 0.24, fontFace: PPT_T.FONT, fontSize: 11.5, bold: true, color: PPT_T.BLUE, align: "center", valign: "middle", margin: 0 });
      slide.addText(
        (c.lines || []).map((t, k, arr) => ({ text: t, options: { breakLine: k !== arr.length - 1 } })),
        { x: cx + 0.04, y: ly + 0.76, w: colW - 0.08, h: lowerH - 0.84, fontFace: PPT_T.FONT, fontSize: 9.5, bold: true, color: PPT_T.TEXT, align: "center", valign: "top", margin: 0, lineSpacingMultiple: 1.12 }
      );
    });
  }

  function timelineSlide(slide) {
    slide.background = { color: "FFFFFF" };
    heading(slide, spec.timeline.heading || "3. 관련 정책 흐름", PPT_P.s3.h3);

    const cols = spec.timeline.columns || ["발표 일자", "구분", "내용"];
    const rows = spec.timeline.rows || [];
    const head = cols.map((c) => ({ text: c, options: { fill: { color: PPT_T.TBL_HEAD }, color: "FFFFFF", bold: true, align: "center", valign: "middle" } }));
    const body = rows.map((r) => {
      const lines = String(r[2]).split("\n");
      const cell3 = [];
      lines.forEach((ln, i) => {
        const rr = pptRuns(i === 0 ? ln : "     " + ln, { bold: true, color: PPT_T.TEXT });
        if (i === 0) rr[0].options.bullet = { code: "2022" };
        if (i !== lines.length - 1) rr[rr.length - 1].options.breakLine = true;
        cell3.push.apply(cell3, rr);
      });
      return [
        { text: pptRuns(r[0], { bold: true, color: PPT_T.TEXT }), options: { align: "center", valign: "middle" } },
        { text: pptRuns(r[1], { bold: true, color: PPT_T.TEXT }), options: { align: "center", valign: "middle" } },
        { text: cell3, options: { align: "left", valign: "middle" } },
      ];
    });

    const tcw = spec.timeline.colWidths || PPT_P.s3.colW;
    const op = spec.opinion || [];
    const OP_PT = 11, OP_LH = (OP_PT * 1.35) / 72;
    const opLines = op.reduce((a, t) => a + pptEstLines("- " + t, PPT_T.W - 0.9, OP_PT, 0.1), 0);
    const barH = Math.max(PPT_P.s3.bar.h, opLines * OP_LH + 0.22);
    const barY = PPT_T.H - barH - 0.06;

    const hasInfo = !!spec.infographic;
    const maxH = hasInfo ? rows.length * 0.6 + PPT_P.s3.headH : Math.min(PPT_P.s3.bar.y, barY) - PPT_P.s3.tbl.y - 0.25;

    let tpt = 10, rowHs, need;
    for (;;) {
      const lh = (tpt * 1.35) / 72;
      rowHs = rows.map((r) => {
        const n = Math.max.apply(null, r.map((c, i) => pptEstLines(c, tcw[i], tpt, 0.2)));
        return Math.min(PPT_P.s3.rowH, Math.max(0.42, n * lh + 0.18));
      });
      need = rowHs.reduce((a, b) => a + b, PPT_P.s3.headH);
      if (need <= maxH || tpt <= 8.5) break;
      tpt -= 0.5;
    }

    slide.addTable([head].concat(body), {
      x: PPT_P.s3.tbl.x, y: PPT_P.s3.tbl.y, w: PPT_P.s3.tbl.w, colW: tcw, rowH: [PPT_P.s3.headH].concat(rowHs),
      border: { type: "solid", color: PPT_T.LINE, pt: 0.75 }, fontFace: PPT_T.FONT, fontSize: tpt, margin: [3, 7, 3, 7], autoPage: false,
    });

    const tblBottom = PPT_P.s3.tbl.y + PPT_P.s3.headH + rowHs.reduce((a, b) => a + b, 0);
    infographicBlock(slide, tblBottom + PPT_P.s3.info.gapTop, barY - PPT_P.s3.info.gapBottom);

    slide.addShape(pres.ShapeType.rect, { x: 0, y: barY, w: PPT_T.W, h: barH, fill: { color: PPT_T.BAR }, line: { color: PPT_T.BAR, width: 0.5 } });
    const opRuns = [];
    op.forEach((t, i) => {
      const r = pptRuns("- " + t, { bold: true, color: PPT_T.TEXT });
      if (i !== op.length - 1) r[r.length - 1].options.breakLine = true;
      opRuns.push.apply(opRuns, r);
    });
    slide.addText(opRuns, { x: 0.25, y: barY, w: PPT_T.W - 0.5, h: barH, fontFace: PPT_T.FONT, fontSize: OP_PT, bold: true, color: PPT_T.TEXT, align: "left", valign: "middle", margin: 0 });
  }

  cover(pres.addSlide());
  summarySlide(pres.addSlide());
  timelineSlide(pres.addSlide());

  return pres.write({ outputType: "blob" });
}
