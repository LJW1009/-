#!/usr/bin/env node
/**
 * make_icons.js — 인포그래픽용 아이콘 PNG 생성
 *   node make_icons.js [출력폴더]
 * react-icons(fa6) → SVG → sharp 래스터화(512px, 네이비 단색)
 */
const fs = require("fs");
const path = require("path");
const React = require("react");
const RDS = require("react-dom/server");
const Fa = require("react-icons/fa6");
const sharp = require("sharp");

const NAVY = "#1F3864";
const OUT = process.argv[2] || path.join(__dirname, "..", "assets", "icons");
fs.mkdirSync(OUT, { recursive: true });

// 논리이름 → react-icons 컴포넌트
const SET = {
  calendar: "FaRegCalendarDays",
  person:   "FaUser",
  house:    "FaHouseChimney",
  clock:    "FaRegClock",
  chart:    "FaChartLine",
  won:      "FaWonSign",
  check:    "FaCircleCheck",
  gauge:    "FaGaugeHigh",
  scale:    "FaScaleBalanced",
  file:     "FaFileLines",
  arrow:    "FaArrowRightLong",
  building: "FaBuilding",
  percent:  "FaPercent",
  bell:     "FaBell",
};

(async () => {
  for (const [name, comp] of Object.entries(SET)) {
    const Icon = Fa[comp];
    if (!Icon) { console.warn("없는 아이콘:", comp); continue; }
    let svg = RDS.renderToStaticMarkup(
      React.createElement(Icon, { color: NAVY, size: 512 }));
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const file = path.join(OUT, `${name}.png`);
    await sharp(Buffer.from(svg)).resize(512, 512, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    }).png().toFile(file);
    console.log("생성:", path.basename(file));
  }
})();
