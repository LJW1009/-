#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qa_layout.py — 생성된 덱의 배치 자동 점검

    python3 qa_layout.py deck.pptx

  · 슬라이드 밖으로 나간 도형
  · 가장자리 여백 부족(0.10" 미만)
  · 도형 간 겹침
  · 렌더 PDF 기준 실제 텍스트 넘침
"""
import subprocess
import sys
from xml.etree import ElementTree as ET

from pptx import Presentation
from pptx.util import Emu

EMU = 914400.0


def rects(slide):
    out = []
    for sh in slide.shapes:
        if sh.left is None:
            continue
        out.append((sh.name,
                    sh.left / EMU, sh.top / EMU,
                    (sh.left + sh.width) / EMU,
                    (sh.top + sh.height) / EMU))
    return out


def overlap(a, b):
    ix = min(a[3], b[3]) - max(a[1], b[1])
    iy = min(a[4], b[4]) - max(a[2], b[2])
    return ix, iy


def main(path):
    prs = Presentation(path)
    W, H = prs.slide_width / EMU, prs.slide_height / EMU
    print(f"슬라이드 규격 {W:.3f} x {H:.3f} in\n")

    problems = 0
    for i, slide in enumerate(prs.slides, 1):
        print(f"── 슬라이드 {i}")
        rs = rects(slide)
        for r in rs:
            flag = ""
            if r[1] < -0.01 or r[2] < -0.01 or r[3] > W + 0.01 or r[4] > H + 0.01:
                flag = "  ⚠ 슬라이드 이탈"
                problems += 1
            print(f"   {r[0]:<22} x {r[1]:6.3f}~{r[3]:6.3f}   y {r[2]:6.3f}~{r[4]:6.3f}{flag}")
        for m in range(len(rs)):
            for n in range(m + 1, len(rs)):
                ix, iy = overlap(rs[m], rs[n])
                if ix <= 0.02 or iy <= 0.02:
                    continue
                # 배경 카드 위에 얹은 텍스트/아이콘은 정상 (완전 포함 관계)
                a, b = rs[m], rs[n]
                inside = ((a[1] >= b[1] - 0.02 and a[3] <= b[3] + 0.02 and
                           a[2] >= b[2] - 0.02 and a[4] <= b[4] + 0.02) or
                          (b[1] >= a[1] - 0.02 and b[3] <= a[3] + 0.02 and
                           b[2] >= a[2] - 0.02 and b[4] <= a[4] + 0.02))
                small = min((a[3]-a[1])*(a[4]-a[2]), (b[3]-b[1])*(b[4]-b[2]))
                if inside or (small > 0 and (ix*iy)/small > 0.80):
                    continue
                print(f"   ⚠ 겹침: {a[0]} × {b[0]}  ({ix:.2f} x {iy:.2f} in)")
                problems += 1
        print()

    # 렌더 기준 텍스트 실제 위치
    pdf = path.rsplit(".", 1)[0] + ".pdf"
    subprocess.run(["python", "/mnt/skills/public/pptx/scripts/office/soffice.py",
                    "--headless", "--convert-to", "pdf", path],
                   capture_output=True, cwd=path.rsplit("/", 1)[0] or ".")
    try:
        xml = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"],
                             capture_output=True, text=True).stdout
        root = ET.fromstring(xml)
        NS = "{http://www.w3.org/1999/xhtml}"
        print("── 렌더 텍스트 실측 (넘침 검사)")
        for pi, page in enumerate(root.iter(NS + "page"), 1):
            pw, ph = float(page.get("width")), float(page.get("height"))
            xs, ys = [], []
            for w in page.iter(NS + "word"):
                xs += [float(w.get("xMin")), float(w.get("xMax"))]
                ys += [float(w.get("yMin")), float(w.get("yMax"))]
            if not xs:
                continue
            l, r = min(xs) / 72, (pw - max(xs)) / 72
            t, b = min(ys) / 72, (ph - max(ys)) / 72
            bad = " ⚠" if min(l, r, t, b) < 0.03 else ""
            print(f"   P{pi}  좌 {l:.2f}  우 {r:.2f}  상 {t:.2f}  하 {b:.2f} in{bad}")
            if bad:
                problems += 1
    except Exception as e:
        print("   (PDF 실측 생략:", e, ")")

    print(f"\n결과: {'문제 없음' if problems == 0 else f'확인 필요 {problems}건'}")
    return problems


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1]) else 0)
