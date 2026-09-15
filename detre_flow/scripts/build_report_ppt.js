#!/usr/bin/env node
/**
 * build_report_ppt.js
 * ------------------------------------------------------------------
 * 블록 기반 다중 슬라이드 생성기 (영업계획팀 하우스 스타일)
 *
 *   node build_report_ppt.js <spec.json> [출력.pptx]
 *
 * build_press_ppt.js 와 동일한 디자인 토큰·마크업을 쓰되,
 * 슬라이드 수와 블록 구성을 자유롭게 정의할 수 있다.
 *
 * spec.slides[] 의 blocks[]
 *   {type:"box",   heading, items[]}           연노랑 요약 박스 (➊➋➌)
 *   {type:"table", heading, columns, colWidths, rows[][], fontSize?}
 *   {type:"info",  heading, before, after, cards[]}   대비카드 + 항목카드
 *   {type:"bar",   lines[]}                    하단 전폭 의견 바
 *
 * 마크업: [[파랑]]  {{파랑+노랑형광}}  \n 줄바꿈
 * ------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const T = {
  W: 10.8333, H: 7.5,
  FONT: "나눔바른고딕",
  NAVY: "003366", TBL_HEAD: "002060",
  BOX: "FFFFCC", BAR: "FFFF99",
  BLUE: "0000FF", MARK: "FFFF00",
  TEXT: "1F1F1F", LINE: "BFBFBF",
};
const M = { x: 0.140, w: 10.472, top: 0.157, headH: 0.337, gap: 0.22 };

const specPath = process.argv[2];
if (!specPath) { console.error("사용법: node build_report_ppt.js <spec.json> [출력.pptx]"); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const outPath = process.argv[3] || path.join(process.cwd(), (spec.meta.fileTag || "report") + ".pptx");

// ── 마크업 파서 ────────────────────────────────────────────────
function runs(src, base) {
  base = base || {};
  const out = [];
  const lines = String(src).split("\n");
  lines.forEach(function (line, li) {
    const parts = line.split(/(\[\[[^\]]*\]\]|\{\{[^}]*\}\})/g).filter(function (s) { return s !== ""; });
    if (parts.length === 0) parts.push("");
    parts.forEach(function (seg, si) {
      const o = Object.assign({}, base);
      let text = seg;
      if (seg.indexOf("[[") === 0) { text = seg.slice(2, -2); o.color = T.BLUE; }
      else if (seg.indexOf("{{") === 0) { text = seg.slice(2, -2); o.color = T.BLUE; o.highlight = T.MARK; }
      if (si === parts.length - 1 && li !== lines.length - 1) o.breakLine = true;
      out.push({ text: text, options: o });
    });
  });
  return out;
}
const plain = function (s) { return String(s).replace(/\[\[|\]\]|\{\{|\}\}/g, ""); };
function emWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u1100-\u11FF\u3000-\u303F\u3130-\u318F\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.52;
  }
  return w;
}
function estLines(text, widthIn, fontPt, padIn) {
  const usable = Math.max(0.4, widthIn - (padIn === undefined ? 0.2 : padIn));
  const perLine = Math.max(4, usable * 72 / fontPt);
  let total = 0;
  for (const seg of plain(text).split("\n")) total += Math.max(1, Math.ceil(emWidth(seg) / perLine));
  return total;
}

const pres = new pptxgen();
pres.defineLayout({ name: "DETRE", width: T.W, height: T.H });
pres.layout = "DETRE";
pres.author = "영업계획팀";
pres.title = spec.meta.title;

function heading(slide, text, y) {
  slide.addText(text, {
    x: M.x, y: y, w: M.w, h: M.headH,
    fontFace: T.FONT, fontSize: 14, bold: true, color: T.TEXT,
    margin: 0, valign: "middle",
  });
  return y + M.headH + 0.08;
}

// ── 표지 ───────────────────────────────────────────────────────
function cover(slide) {
  slide.background = { color: "FFFFFF" };
  slide.addText(spec.meta.title, {
    shape: pres.ShapeType.roundRect, rectRadius: 0.174,
    x: 0.601, y: 0.857, w: 9.630, h: 1.043,
    fill: { color: T.NAVY }, line: { color: "FFFFFF", width: 3 },
    shadow: { type: "outer", color: "808080", opacity: 0.5, blur: 8, offset: 3, angle: 45 },
    fontFace: T.FONT, fontSize: 20, bold: true, color: "FFFFFF",
    align: "center", valign: "middle",
  });
  if (spec.meta.subtitle) {
    slide.addText(spec.meta.subtitle, {
      x: 0.601, y: 1.94, w: 9.630, h: 0.32,
      fontFace: T.FONT, fontSize: 12, bold: true, color: "595959",
      align: "center", valign: "middle", margin: 0,
    });
  }
  const logo = path.join(__dirname, "..", "assets", "cover_logo.png");
  if (fs.existsSync(logo)) slide.addImage({ path: logo, x: 3.766, y: 2.44, w: 3.299, h: 2.941 });
  slide.addText(
    [{ text: spec.meta.yearMonth, options: { breakLine: true } },
     { text: spec.meta.team, options: {} }],
    { x: 2.964, y: 5.70, w: 4.497, h: 1.043,
      fontFace: T.FONT, fontSize: 28, bold: true, color: T.TEXT,
      align: "center", valign: "top" });
  slide.addText(spec.meta.source, {
    x: 0, y: 7.087, w: 8.6, h: 0.300,
    fontFace: T.FONT, fontSize: 12, bold: true, color: T.TEXT, valign: "middle" });
}

// ── 블록 렌더러 ────────────────────────────────────────────────
function renderBox(slide, b, y) {
  if (b.heading) y = heading(slide, b.heading, y);
  const MARKS = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑"];
  const PT = b.fontSize || 11, LH = PT * 1.5 / 72;
  const n = b.items.reduce(function (a, t) { return a + estLines("➊ " + t, M.w, PT, 0.26); }, 0);
  const h = n * LH + 0.30;
  slide.addShape(pres.ShapeType.rect, {
    x: M.x - 0.067, y: y, w: M.w, h: h,
    fill: { color: T.BOX }, line: { color: T.BOX, width: 0.5 } });
  const body = [];
  b.items.forEach(function (t, i) {
    body.push({ text: (MARKS[i] || "▪") + " ", options: {} });
    const r = runs(t);
    if (i !== b.items.length - 1) r[r.length - 1].options.breakLine = true;
    body.push.apply(body, r);
  });
  slide.addText(body, {
    x: M.x, y: y - 0.106, w: M.w, h: h + 0.135,
    fontFace: T.FONT, fontSize: PT, bold: true, color: T.TEXT,
    lineSpacingMultiple: 1.5, valign: "top", margin: [8, 8, 2, 2] });
  return y + h + M.gap;
}

function renderTable(slide, b, y, bottomLimit) {
  if (b.heading) y = heading(slide, b.heading, y);
  const cw = b.colWidths || Array(b.columns.length).fill(M.w / b.columns.length);
  const head = b.columns.map(function (c) {
    return { text: c, options: { fill: { color: T.TBL_HEAD }, color: "FFFFFF",
             bold: true, align: "center", valign: "middle" } };
  });
  const body = b.rows.map(function (r) {
    return r.map(function (cell, ci) {
      return { text: runs(cell, { bold: true, color: T.TEXT }),
               options: { align: ci === 0 ? "center" : "left", valign: "middle" } };
    });
  });
  const avail = bottomLimit - y - 0.10;
  let pt = b.fontSize || 10, rowHs, need;
  for (;;) {
    const lh = pt * 1.34 / 72;
    rowHs = b.rows.map(function (r) {
      const n = Math.max.apply(null, r.map(function (c, i) { return estLines(c, cw[i], pt, 0.19); }));
      return Math.max(0.30, n * lh + 0.13);
    });
    need = rowHs.reduce(function (a, c) { return a + c; }, 0.26);
    if (need <= avail || pt <= 8) break;
    pt -= 0.5;
  }
  if (need < avail && b.grow !== false) {
    const extra = Math.min((avail - need) / b.rows.length, 0.52);
    rowHs = rowHs.map(function (h) { return h + extra; });
    need += extra * b.rows.length;
  }
  slide.addTable([head].concat(body), {
    x: M.x, y: y, w: M.w, colW: cw,
    rowH: [0.26].concat(rowHs),
    border: { type: "solid", color: T.LINE, pt: 0.75 },
    fontFace: T.FONT, fontSize: pt, margin: [2, 7, 2, 7], autoPage: false });
  return y + need + M.gap;
}

function renderInfo(slide, b, y, bottomLimit) {
  if (b.heading) y = heading(slide, b.heading, y);
  const ICON = path.join(__dirname, "..", "assets", "icons");
  const avail = bottomLimit - y - 0.10;
  const cards = b.cards || [];
  const lowerH = cards.length ? Math.min(1.34, avail * 0.46) : 0;
  const gap = cards.length ? 0.13 : 0;
  const upperH = avail - lowerH - gap;
  const AW = 0.62, CW = (M.w - AW - 0.24) / 2;
  [{ d: b.before, x: M.x, fill: "F0F0F0", fg: T.TEXT, sub: "595959" },
   { d: b.after, x: M.x + CW + AW + 0.24, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" }]
  .forEach(function (s) {
    if (!s.d) return;
    slide.addShape(pres.ShapeType.roundRect, {
      x: s.x, y: y, w: CW, h: upperH, rectRadius: 0.10,
      fill: { color: s.fill }, line: { color: s.fill, width: 0.5 } });
    slide.addText(s.d.label, { x: s.x, y: y + 0.07, w: CW, h: 0.30,
      fontFace: T.FONT, fontSize: 13, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
    slide.addText(s.d.value, { x: s.x, y: y + 0.36, w: CW, h: Math.max(0.36, upperH - 0.92),
      fontFace: T.FONT, fontSize: s.d.valueSize || 19, bold: true, color: s.fg, align: "center", valign: "middle", margin: 0 });
    if (s.d.caption) slide.addText(s.d.caption, { x: s.x, y: y + upperH - 0.54, w: CW, h: 0.24,
      fontFace: T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
    if (s.d.note) slide.addText(s.d.note, { x: s.x, y: y + upperH - 0.31, w: CW, h: 0.24,
      fontFace: T.FONT, fontSize: 10, bold: true, color: s.sub, align: "center", valign: "middle", margin: 0 });
  });
  if (b.before && b.after) {
    slide.addShape(pres.ShapeType.rightArrow, {
      x: M.x + CW + 0.12, y: y + upperH / 2 - 0.15, w: AW, h: 0.30,
      fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });
  }
  if (cards.length) {
    const ly = y + upperH + gap;
    slide.addShape(pres.ShapeType.roundRect, {
      x: M.x, y: ly, w: M.w, h: lowerH, rectRadius: 0.10,
      fill: { color: "FFFFFF" }, line: { color: "D6DCE8", width: 1 } });
    const colW = M.w / cards.length;
    cards.forEach(function (c, i) {
      const cx = M.x + colW * i;
      const ip = path.join(ICON, (c.icon || "check") + ".png");
      if (fs.existsSync(ip)) slide.addImage({ path: ip, x: cx + colW / 2 - 0.19, y: ly + 0.11, w: 0.38, h: 0.38 });
      slide.addText(c.title, { x: cx, y: ly + 0.52, w: colW, h: 0.24,
        fontFace: T.FONT, fontSize: 11.5, bold: true, color: T.BLUE, align: "center", valign: "middle", margin: 0 });
      slide.addText((c.lines || []).map(function (t, k, a) {
          return { text: t, options: { breakLine: k !== a.length - 1 } }; }),
        { x: cx + 0.04, y: ly + 0.76, w: colW - 0.08, h: lowerH - 0.84,
          fontFace: T.FONT, fontSize: 9.5, bold: true, color: T.TEXT,
          align: "center", valign: "top", margin: 0, lineSpacingMultiple: 1.12 });
    });
  }
  return y + avail + M.gap;
}

// ── 번호 항목 머리띠 (인포그래픽 스타일을 하우스 테마로 재현) ──
function renderItemHead(slide, b, y) {
  const H = 0.34;
  slide.addShape(pres.ShapeType.roundRect, {
    x: M.x, y: y, w: M.w, h: H, rectRadius: 0.05,
    fill: { color: "EDF0F6" }, line: { color: "EDF0F6", width: 0.5 },
  });
  slide.addShape(pres.ShapeType.ellipse, {
    x: M.x + 0.07, y: y + 0.035, w: 0.27, h: 0.27,
    fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 },
  });
  slide.addText(String(b.no), {
    x: M.x + 0.07, y: y + 0.035, w: 0.27, h: 0.27,
    fontFace: T.FONT, fontSize: 10, bold: true, color: "FFFFFF",
    align: "center", valign: "middle", margin: 0,
  });
  const runsArr = [];
  if (b.tag) runsArr.push({ text: "[" + b.tag + "] ", options: { color: T.BLUE } });
  runsArr.push.apply(runsArr, runs(b.title, { color: "1F3864" }));
  slide.addText(runsArr, {
    x: M.x + 0.44, y: y, w: M.w - 0.5, h: H,
    fontFace: T.FONT, fontSize: 11.5, bold: true, color: "1F3864",
    align: "left", valign: "middle", margin: 0,
  });
  return y + H + 0.08;
}

// ── 현행 → 개정안 대비 띠 ──────────────────────────────────────
function renderCompare(slide, b, y) {
  const H = b.height || 0.74;
  const AW = 0.52, CW = (M.w - AW - 0.22) / 2;
  [{ d: b.left, x: M.x, fill: "F0F0F0", fg: T.TEXT, sub: "595959" },
   { d: b.right, x: M.x + CW + AW + 0.22, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" }]
  .forEach(function (s) {
    slide.addShape(pres.ShapeType.roundRect, {
      x: s.x, y: y, w: CW, h: H, rectRadius: 0.07,
      fill: { color: s.fill }, line: { color: s.fill, width: 0.5 } });
    slide.addText(s.d.label, {
      x: s.x, y: y + 0.05, w: CW, h: 0.19,
      fontFace: T.FONT, fontSize: 9.5, bold: true, color: s.sub,
      align: "center", valign: "middle", margin: 0 });
    slide.addText(runs(s.d.value, { color: s.fg }), {
      x: s.x + 0.08, y: y + 0.25, w: CW - 0.16, h: H - 0.30,
      fontFace: T.FONT, fontSize: s.d.size || 12.5, bold: true, color: s.fg,
      align: "center", valign: "middle", margin: 0 });
  });
  slide.addShape(pres.ShapeType.rightArrow, {
    x: M.x + CW + 0.11, y: y + H / 2 - 0.13, w: AW, h: 0.26,
    fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 } });
  return y + H + 0.16;
}

function renderImages(slide, b, y, bottomLimit) {
  if (b.heading) y = heading(slide, b.heading, y);
  const _is = require("image-size");
  const sizeOf = _is.imageSize || _is.default || _is;
  const dir = path.join(__dirname, "..", "assets", "infographic");
  const items = b.items || [];
  const gap = b.gap === undefined ? 0.18 : b.gap;
  const avail = bottomLimit - y - 0.08;
  const colW = (M.w - gap * (items.length - 1)) / items.length;
  let maxH = 0;
  items.forEach(function (it, i) {
    const p = path.isAbsolute(it.file) ? it.file : path.join(dir, it.file);
    if (!fs.existsSync(p)) return;
    const d = sizeOf(fs.readFileSync(p));
    let w = colW, h = colW * d.height / d.width;
    if (h > avail) { h = avail; w = h * d.width / d.height; }
    const x = M.x + (colW + gap) * i + (colW - w) / 2;
    slide.addImage({ path: p, x: x, y: y, w: w, h: h });
    if (h > maxH) maxH = h;
  });
  return y + maxH + 0.12;
}

function renderNote(slide, b, y) {
  const PT = b.fontSize || 8.5;
  const n = estLines(b.text, M.w, PT, 0.1);
  const h = n * PT * 1.45 / 72 + 0.04;
  slide.addText(runs(b.text, { bold: false, color: "595959" }), {
    x: M.x + 0.02, y: y, w: M.w, h: h,
    fontFace: T.FONT, fontSize: PT, color: "595959",
    align: "left", valign: "top", margin: 0 });
  return y + h + 0.10;
}

function renderBar(slide, lines) {
  const PT = 11, LH = PT * 1.35 / 72;
  const n = lines.reduce(function (a, t) { return a + estLines("- " + t, T.W - 0.9, PT, 0.1); }, 0);
  const h = Math.max(0.68, n * LH + 0.22);
  const y = T.H - h - 0.06;
  slide.addShape(pres.ShapeType.rect, { x: 0, y: y, w: T.W, h: h,
    fill: { color: T.BAR }, line: { color: T.BAR, width: 0.5 } });
  const rr = [];
  lines.forEach(function (t, i) {
    const r = runs("- " + t, { bold: true, color: T.TEXT });
    if (i !== lines.length - 1) r[r.length - 1].options.breakLine = true;
    rr.push.apply(rr, r);
  });
  slide.addText(rr, { x: 0.25, y: y, w: T.W - 0.5, h: h,
    fontFace: T.FONT, fontSize: PT, bold: true, color: T.TEXT,
    align: "left", valign: "middle", margin: 0 });
  return y;
}

// ── 조립 ───────────────────────────────────────────────────────
cover(pres.addSlide());
(spec.slides || []).forEach(function (sl) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  const blocks = sl.blocks || [];
  const bar = blocks.filter(function (b) { return b.type === "bar"; })[0];
  const bottom = bar ? renderBar(slide, bar.lines) - 0.14 : T.H - 0.22;

  const flow = blocks.filter(function (b) { return b.type !== "bar"; });
  const FIXED = { note: 1, itemhead: 1, compare: 1 };
  const nFlex = flow.filter(function (b) { return !FIXED[b.type]; }).length;
  let flexSeen = 0;
  // 가변 높이 블록(table/info)은 남는 공간을 나눠 갖는다
  let y = M.top;
  flow.forEach(function (b, i) {
    if (!FIXED[b.type]) flexSeen += 1;
    const isLast = flexSeen === nFlex;
    const limit = isLast ? bottom : bottom;
    if (b.type === "note") { y = renderNote(slide, b, y); return; }
    if (b.type === "itemhead") { y = renderItemHead(slide, b, y); return; }
    if (b.type === "compare") { y = renderCompare(slide, b, y); return; }
    if (b.type === "box") y = renderBox(slide, b, y);
    else if (b.type === "table") y = renderTable(slide, b, y, b.maxBottom || (isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || (1 / Math.max(1, nFlex - flexSeen + 1))))));
    else if (b.type === "images") y = renderImages(slide, b, y, isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || (1 / Math.max(1, nFlex - flexSeen + 1)))));
    else if (b.type === "info") y = renderInfo(slide, b, y, isLast ? limit : Math.min(limit, y + (limit - y) * (b.share || (1 / Math.max(1, nFlex - flexSeen + 1)))));
  });
});

pres.writeFile({ fileName: outPath }).then(function () { console.log("생성 완료:", outPath); });
