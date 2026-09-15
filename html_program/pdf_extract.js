"use strict";

/* ============================================================
   PDF 텍스트 추출 (pdf.js) + 보도자료 구조 휴리스틱 파서
   ============================================================ */
let pdfWorkerReady = false;
function ensurePdfWorker() {
  if (pdfWorkerReady) return;
  const workerCode = document.getElementById("pdfjs-worker-src").textContent;
  const blob = new Blob([workerCode], { type: "application/javascript" });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  pdfWorkerReady = true;
}

/** 한 페이지의 텍스트 아이템을 y좌표로 줄을 묶고, 줄 안에서는 x좌표 순으로
 *  정렬 → x간격이 크면 공백을 넣어 자연스러운 문단으로 재구성한다.
 *  (pdf.js가 주는 항목 순서는 시각적 읽기 순서와 다를 수 있어 y로 재정렬) */
function reconstructPage(content) {
  const items = content.items.filter((it) => it.str !== undefined);
  const lines = [];
  let cur = null;
  const Y_TOL = 2;
  for (const it of items) {
    const y = it.transform[5];
    if (!cur || Math.abs(cur.y - y) > Y_TOL) {
      cur = { y, parts: [] };
      lines.push(cur);
    }
    cur.parts.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  let text = "";
  for (const line of lines) {
    line.parts.sort((a, b) => a.transform[4] - b.transform[4]);
    let lineText = "";
    let prevEndX = null;
    let prevHeight = 10;
    for (const it of line.parts) {
      const x = it.transform[4];
      const w = it.width || 0;
      const h = Math.abs(it.transform[3]) || prevHeight;
      prevHeight = h;
      if (prevEndX !== null && x - prevEndX > h * 0.28) lineText += " ";
      lineText += it.str;
      prevEndX = x + w;
    }
    text += lineText.trim() + "\n";
  }
  return text;
}

async function extractPdfText(file) {
  ensurePdfWorker();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += reconstructPage(content) + "\n";
  }
  return text;
}

/** 정부 보도자료 특유의 구조(제목 → "- " 하이라이트 불릿 → □/ㅇ 본문)에서
 *  제목·요약 불릿·배포일을 뽑아낸다. 완벽한 요약은 아니며(사람 판단이
 *  필요한 부분은 원문 전체를 함께 보여줘 직접 고르거나 채팅으로 넘기게 한다),
 *  표지/요약 칸을 빠르게 채우기 위한 초안 추출이다. */
function parsePressRelease(rawText) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const isPageMark = (l) => /^-?\s*\d+\s*-?$/.test(l) || /^-\s*\d+\s*-$/.test(l);

  let dateStr = null;
  const dateM = rawText.match(/배포\s*([0-9]{4}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.?\([^)]*\))/);
  if (dateM) dateStr = dateM[1].replace(/\s+/g, " ").trim();
  else {
    const m2 = rawText.match(/([0-9]{4}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2}\.?\([^)]*\))/);
    if (m2) dateStr = m2[1].replace(/\s+/g, " ").trim();
  }
  let yearMonth = "";
  const ymM = dateStr && dateStr.match(/([0-9]{4})\.\s*([0-9]{1,2})\./);
  if (ymM) yearMonth = `${ymM[1]}. ${ymM[2].padStart(2, "0")}`;

  let idx = 0;
  while (idx < lines.length && (isPageMark(lines[idx]) || lines[idx] === "보도자료" || /보도시점|배포/.test(lines[idx]))) idx++;

  const titleLines = [];
  while (idx < lines.length && !lines[idx].startsWith("-") && !lines[idx].startsWith("□") && !lines[idx].startsWith("ㅇ") && titleLines.length < 4) {
    titleLines.push(lines[idx]);
    idx++;
  }
  const title = titleLines.join(" ").replace(/,\s*$/, "").trim();

  const bullets = [];
  while (idx < lines.length && lines[idx].startsWith("-") && bullets.length < 6) {
    bullets.push(lines[idx].replace(/^-\s*/, "").trim());
    idx++;
  }

  return { title, bullets, dateStr, yearMonth };
}
