#!/usr/bin/env node
/**
 * build_press_ppt.js  (rev.2)
 * ------------------------------------------------------------------
 * 보도자료 요약 PPT 생성기 — 영업계획팀 하우스 스타일
 *
 *   node build_press_ppt.js <spec.json> [출력경로.pptx]
 *
 * 좌표·서식은 기존 결재본 PPT의 OOXML에서 EMU 단위로 역산해 고정.
 *
 * ── 셀/문장 내 강조 마크업 ──────────────────────────────────
 *   [[텍스트]]   → 파랑 0000FF
 *   {{텍스트}}   → 파랑 0000FF + 노랑 형광 FFFF00
 *   \n           → 줄바꿈
 * ------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

// ── 하우스 디자인 토큰 (원본 OOXML에서 추출) ──────────────────
const T = {
  W: 10.8333, H: 7.5,
  FONT: "나눔바른고딕",
  NAVY: "003366",      // 표지 타이틀 바
  TBL_HEAD: "002060",  // 표 머리행
  BOX: "FFFFCC",       // 내용요약 박스
  BAR: "FFFF99",       // 하단 의견 바
  BLUE: "0000FF",      // 강조 텍스트
  MARK: "FFFF00",      // 형광
  TEXT: "1F1F1F",
  LINE: "BFBFBF",
};

// 원본 좌표 (EMU / 914400 = inch) — 사용자 검수 반영본
const P = {
  cover: {
    bar:   { x: 0.601, y: 0.857, w: 9.630, h: 1.043 },
    logo:  { x: 3.766, y: 2.370, w: 3.299, h: 2.941 },
    stamp: { x: 2.964, y: 5.655, w: 4.497, h: 1.043 },
    src:   { x: 0.000, y: 7.087, w: 5.480, h: 0.300 },
  },
  s2: {
    h1:   { x: 0.180, y: 0.294, w: 5.377, h: 0.337 },
    box:  { x: 0.113, y: 0.798, w: 10.470, h: 1.904 },
    text: { x: 0.180, y: 0.692, w: 10.470, h: 2.039 },
    h2y: 3.274, tblY: 3.656, tblPt: 11,
  },
  s3: {
    h3:  { x: 0.140, y: 0.157, w: 5.377, h: 0.337 },
    tbl: { x: 0.140, y: 0.573, w: 10.472 },
    colW: [1.416, 4.019, 5.037],
    headH: 0.23, rowH: 0.851,
    bar: { x: 0, y: 6.395, w: 10.8333, h: 1.045 },
    // 4. 인포그래픽 영역 (표 아래 ~ 의견 바 위)
    info: { x: 0.140, w: 10.472, gapTop: 0.20, gapBottom: 0.14, headH: 0.30 },
  },
};

const specPath = process.argv[2];
if (!specPath) {
  console.error("사용법: node build_press_ppt.js <spec.json> [출력.pptx]");
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const outPath = process.argv[3] ||
  path.join(process.cwd(), `${spec.meta.fileTag || "press"}_영업계획팀.pptx`);

// ── 마크업 → pptxgenjs run 배열 ───────────────────────────────
function runs(src, base) {
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
      if (seg.indexOf("[[") === 0) { text = seg.slice(2, -2); o.color = T.BLUE; }
      else if (seg.indexOf("{{") === 0) { text = seg.slice(2, -2); o.color = T.BLUE; o.highlight = T.MARK; }
      if (si === parts.length - 1 && li !== lines.length - 1) o.breakLine = true;
      out.push({ text: text, options: o });
    });
  });
  return out;
}
const plain = (s) => String(s).replace(/\[\[|\]\]|\{\{|\}\}/g, "");

// ── 텍스트 폭 계산 (한글 1em / 영숫자 0.5em) ─────────────────
function emWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u1100-\u11FF\u3000-\u303F\u3130-\u318F\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.52;
  }
  return w;
}
/** 주어진 폭(inch)·글자크기(pt)에서 줄바꿈 후 줄 수 */
function estLines(text, widthIn, fontPt, padIn) {
  const usable = Math.max(0.4, widthIn - (padIn === undefined ? 0.2 : padIn));
  const perLine = Math.max(4, usable * 72 / fontPt);
  let total = 0;
  for (const seg of plain(text).split("\n")) {
    total += Math.max(1, Math.ceil(emWidth(seg) / perLine));
  }
  return total;
}

const pres = new pptxgen();
pres.defineLayout({ name: "DETRE", width: T.W, height: T.H });
pres.layout = "DETRE";
pres.author = "영업계획팀";
pres.title = spec.meta.title;

function heading(slide, text, pos) {
  slide.addText(text, Object.assign({}, pos, {
    fontFace: T.FONT, fontSize: 14, bold: true, color: T.TEXT,
    margin: 0, valign: "middle",
  }));
}

// ── 1. 표지 ───────────────────────────────────────────────────
function cover(slide) {
  slide.background = { color: "FFFFFF" };

  slide.addText(spec.meta.title, Object.assign({}, P.cover.bar, {
    shape: pres.ShapeType.roundRect, rectRadius: 0.174,
    fill: { color: T.NAVY }, line: { color: "FFFFFF", width: 3 },
    shadow: { type: "outer", color: "808080", opacity: 0.5, blur: 8, offset: 3, angle: 45 },
    fontFace: T.FONT, fontSize: 20, bold: true, color: "FFFFFF",
    align: "center", valign: "middle",
  }));

  const logo = path.join(__dirname, "..", "assets", "cover_logo.png");
  if (fs.existsSync(logo)) slide.addImage(Object.assign({ path: logo }, P.cover.logo));

  slide.addText(
    [{ text: spec.meta.yearMonth, options: { breakLine: true } },
     { text: spec.meta.team, options: {} }],
    Object.assign({}, P.cover.stamp, {
      fontFace: T.FONT, fontSize: 28, bold: true, color: T.TEXT,
      align: "center", valign: "top",
    }));

  slide.addText(spec.meta.source, Object.assign({}, P.cover.src, {
    fontFace: T.FONT, fontSize: 12, bold: true, color: T.TEXT, valign: "middle",
  }));
}

// ── 2. 내용요약 + 변경사항 ────────────────────────────────────
function summary(slide) {
  slide.background = { color: "FFFFFF" };
  heading(slide, spec.summary.heading || "1. 내용요약", P.s2.h1);

  const MARKS = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑"];
  const items = spec.summary.items || [];

  // 11pt / 행간 150% → 실제 줄 수로 박스 높이 산정
  const SUM_PT = 11, SUM_LH = SUM_PT * 1.5 / 72;
  const nLines = items.reduce(
    (a, t) => a + estLines("➊ " + t, P.s2.box.w, SUM_PT, 0.26), 0);
  const boxH = Math.max(P.s2.box.h, nLines * SUM_LH + 0.30);

  slide.addShape(pres.ShapeType.rect, Object.assign({}, P.s2.box, {
    h: boxH, fill: { color: T.BOX }, line: { color: T.BOX, width: 0.5 },
  }));

  const body = [];
  items.forEach((t, i) => {
    body.push({ text: (MARKS[i] || "▪") + " ", options: {} });
    const r = runs(t);
    if (i !== items.length - 1) r[r.length - 1].options.breakLine = true;
    body.push.apply(body, r);
  });
  slide.addText(body, Object.assign({}, P.s2.text, {
    h: boxH + 0.135,
    fontFace: T.FONT, fontSize: SUM_PT, bold: true, color: T.TEXT,
    lineSpacingMultiple: 1.5, valign: "top", margin: [8, 8, 2, 2],
  }));

  // 2. 변경사항
  const h2y = Math.max(P.s2.h2y, P.s2.box.y + boxH + 0.20);
  heading(slide, spec.changes.heading || "2. 변경사항",
          { x: P.s2.h1.x, y: h2y, w: P.s2.h1.w, h: P.s2.h1.h });

  const tblY = Math.max(P.s2.tblY, h2y + 0.38);
  const availH = T.H - tblY - 0.50;

  if (spec.changes.mode === "image" && spec.changes.imagePath) {
    const img = path.resolve(path.dirname(specPath), spec.changes.imagePath);
    slide.addImage({ path: img, x: 2.36, y: tblY,
      sizing: { type: "contain", w: 5.86, h: availH } });
    return;
  }

  const cols = spec.changes.columns;
  const rows = spec.changes.rows || [];
  const head = cols.map(function (c) {
    return { text: c, options: { fill: { color: T.TBL_HEAD }, color: "FFFFFF",
             bold: true, align: "center", valign: "middle" } };
  });
  const body2 = rows.map(function (r) {
    return r.map(function (cell, ci) {
      return { text: runs(cell, { bold: true, color: T.TEXT }),
               options: { align: ci === 0 ? "center" : "left", valign: "middle" } };
    });
  });

  // 셀별 실제 줄 수 → 행 높이. 넘치면 폰트를 0.5pt씩 줄여 맞춘다.
  const cw = spec.changes.colWidths || [2.10, 4.10, 4.27];
  let pt = P.s2.tblPt, rowHs, need;
  for (;;) {
    const lh = pt * 1.32 / 72;
    rowHs = rows.map(function (r) {
      const n = Math.max.apply(null, r.map(function (c, i) {
        return estLines(c, cw[i], pt, 0.19);
      }));
      return Math.max(0.30, n * lh + 0.12);
    });
    need = rowHs.reduce(function (a, b) { return a + b; }, 0.26);
    if (need <= availH || pt <= 8.5) break;
    pt -= 0.5;
  }
  // 남는 여백은 각 행에 고르게 분배 (아래쪽이 비어 보이지 않도록)
  if (need < availH) {
    const extra = Math.min((availH - need) / rows.length, 0.34);
    rowHs = rowHs.map(function (h) { return h + extra; });
  }
  slide.addTable([head].concat(body2), {
    x: P.s2.box.x, y: tblY, w: P.s2.box.w,
    colW: cw,
    rowH: [0.26].concat(rowHs),
    border: { type: "solid", color: T.LINE, pt: 0.75 },
    fontFace: T.FONT, fontSize: pt, margin: [2, 7, 2, 7], autoPage: false,
  });
}

// ── 4. 종합 정리 인포그래픽 (표 아래 배치) ────────────────────
function infographic(slide, top, bottom) {
  const g = spec.infographic;
  if (!g) return;

  const ICON = path.join(__dirname, "..", "assets", "icons");
  const X = P.s3.info.x, W = P.s3.info.w;
  let y = top;

  if (g.heading) {
    heading(slide, g.heading, { x: X, y: y, w: 5.377, h: P.s3.info.headH });
    y += P.s3.info.headH + 0.06;
  }

  const avail = bottom - y;
  const cards = g.cards || [];
  const lowerH = cards.length ? Math.min(1.34, avail * 0.46) : 0;
  const gap = cards.length ? 0.13 : 0;
  const upperH = avail - lowerH - gap;

  // ── 상단: 종전 → 개정 대비 카드 ─────────────────────────────
  const AW = 0.62, CW = (W - AW - 0.24) / 2;
  const pair = [
    { d: g.before, x: X, fill: "F0F0F0", fg: T.TEXT, sub: "595959" },
    { d: g.after,  x: X + CW + AW + 0.24, fill: "1F3864", fg: "FFFFFF", sub: "D6DCE8" },
  ];
  pair.forEach(function (s) {
    if (!s.d) return;
    slide.addShape(pres.ShapeType.roundRect, {
      x: s.x, y: y, w: CW, h: upperH, rectRadius: 0.10,
      fill: { color: s.fill }, line: { color: s.fill, width: 0.5 },
    });
    slide.addText(s.d.label, {
      x: s.x, y: y + 0.07, w: CW, h: 0.30,
      fontFace: T.FONT, fontSize: 13, bold: true, color: s.fg,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.d.value, {
      x: s.x, y: y + 0.36, w: CW, h: Math.max(0.36, upperH - 0.92),
      fontFace: T.FONT, fontSize: 19, bold: true, color: s.fg,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.d.caption || "", {
      x: s.x, y: y + upperH - 0.54, w: CW, h: 0.24,
      fontFace: T.FONT, fontSize: 10, bold: true, color: s.sub,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(s.d.note || "", {
      x: s.x, y: y + upperH - 0.31, w: CW, h: 0.24,
      fontFace: T.FONT, fontSize: 10, bold: true, color: s.sub,
      align: "center", valign: "middle", margin: 0,
    });
  });

  // 가운데 화살표
  slide.addShape(pres.ShapeType.rightArrow, {
    x: X + CW + 0.12, y: y + upperH / 2 - 0.15, w: AW, h: 0.30,
    fill: { color: "1F3864" }, line: { color: "1F3864", width: 0.5 },
  });

  // ── 하단: 핵심 항목 카드 ────────────────────────────────────
  if (!cards.length) return;
  const ly = y + upperH + gap;
  slide.addShape(pres.ShapeType.roundRect, {
    x: X, y: ly, w: W, h: lowerH, rectRadius: 0.10,
    fill: { color: "FFFFFF" }, line: { color: "D6DCE8", width: 1 },
  });

  const n = cards.length, colW = W / n;
  cards.forEach(function (c, i) {
    const cx = X + colW * i;
    const ip = path.join(ICON, (c.icon || "check") + ".png");
    if (fs.existsSync(ip)) {
      slide.addImage({ path: ip, x: cx + colW / 2 - 0.19, y: ly + 0.11, w: 0.38, h: 0.38 });
    }
    slide.addText(c.title, {
      x: cx, y: ly + 0.52, w: colW, h: 0.24,
      fontFace: T.FONT, fontSize: 11.5, bold: true, color: T.BLUE,
      align: "center", valign: "middle", margin: 0,
    });
    slide.addText(
      (c.lines || []).map(function (t, k, arr) {
        return { text: t, options: { breakLine: k !== arr.length - 1 } };
      }),
      { x: cx + 0.04, y: ly + 0.76, w: colW - 0.08, h: lowerH - 0.84,
        fontFace: T.FONT, fontSize: 9.5, bold: true, color: T.TEXT,
        align: "center", valign: "top", margin: 0, lineSpacingMultiple: 1.12 });
  });
}

// ── 3. 정책 흐름 + 인포그래픽 + 의견 ──────────────────────────
function timeline(slide) {
  slide.background = { color: "FFFFFF" };
  heading(slide, spec.timeline.heading || "3. 관련 정책 흐름", P.s3.h3);

  const cols = spec.timeline.columns || ["발표 일자", "구분", "내용"];
  const rows = spec.timeline.rows || [];

  const head = cols.map(function (c) {
    return { text: c, options: { fill: { color: T.TBL_HEAD }, color: "FFFFFF",
             bold: true, align: "center", valign: "middle" } };
  });

  const body = rows.map(function (r) {
    const lines = String(r[2]).split("\n");
    const cell3 = [];
    lines.forEach(function (ln, i) {
      const rr = runs(i === 0 ? ln : "     " + ln, { bold: true, color: T.TEXT });
      if (i === 0) rr[0].options.bullet = { code: "2022" };
      if (i !== lines.length - 1) rr[rr.length - 1].options.breakLine = true;
      cell3.push.apply(cell3, rr);
    });
    return [
      { text: runs(r[0], { bold: true, color: T.TEXT }),
        options: { align: "center", valign: "middle" } },
      { text: runs(r[1], { bold: true, color: T.TEXT }),
        options: { align: "center", valign: "middle" } },
      { text: cell3, options: { align: "left", valign: "middle" } },
    ];
  });

  const tcw = spec.timeline.colWidths || P.s3.colW;
  const op = spec.opinion || [];
  const OP_PT = 11, OP_LH = OP_PT * 1.35 / 72;
  const opLines = op.reduce(function (a, t) {
    return a + estLines("- " + t, T.W - 0.9, OP_PT, 0.1);
  }, 0);
  const barH = Math.max(P.s3.bar.h, opLines * OP_LH + 0.22);
  const barY = T.H - barH - 0.06;

  // 인포그래픽이 있으면 표는 원본 높이(0.851")를 넘기지 않도록 고정
  const hasInfo = !!spec.infographic;
  const maxH = hasInfo
    ? (rows.length * 0.60 + P.s3.headH)
    : (Math.min(P.s3.bar.y, barY) - P.s3.tbl.y - 0.25);

  let tpt = 10, rowHs, need;
  for (;;) {
    const lh = tpt * 1.35 / 72;
    rowHs = rows.map(function (r) {
      const n = Math.max.apply(null, r.map(function (c, i) {
        return estLines(c, tcw[i], tpt, 0.20);
      }));
      return Math.min(P.s3.rowH, Math.max(0.42, n * lh + 0.18));
    });
    need = rowHs.reduce(function (a, b) { return a + b; }, P.s3.headH);
    if (need <= maxH || tpt <= 8.5) break;
    tpt -= 0.5;
  }

  slide.addTable([head].concat(body), {
    x: P.s3.tbl.x, y: P.s3.tbl.y, w: P.s3.tbl.w,
    colW: tcw,
    rowH: [P.s3.headH].concat(rowHs),
    border: { type: "solid", color: T.LINE, pt: 0.75 },
    fontFace: T.FONT, fontSize: tpt, margin: [3, 7, 3, 7], autoPage: false,
  });

  // 4. 종합 정리 인포그래픽
  const tblBottom = P.s3.tbl.y + P.s3.headH +
    rowHs.reduce(function (a, b) { return a + b; }, 0);
  infographic(slide, tblBottom + P.s3.info.gapTop, barY - P.s3.info.gapBottom);

  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: barY, w: T.W, h: barH,
    fill: { color: T.BAR }, line: { color: T.BAR, width: 0.5 },
  });
  const opRuns = [];
  op.forEach(function (t, i) {
    const r = runs("- " + t, { bold: true, color: T.TEXT });
    if (i !== op.length - 1) r[r.length - 1].options.breakLine = true;
    opRuns.push.apply(opRuns, r);
  });
  slide.addText(opRuns, {
    x: 0.25, y: barY, w: T.W - 0.5, h: barH,
    fontFace: T.FONT, fontSize: OP_PT, bold: true, color: T.TEXT,
    align: "left", valign: "middle", margin: 0,
  });
}

cover(pres.addSlide());
summary(pres.addSlide());
timeline(pres.addSlide());

pres.writeFile({ fileName: outPath }).then(function () {
  console.log("생성 완료:", outPath);
});
