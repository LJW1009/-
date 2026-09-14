#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ingest_pdf.py
------------------------------------------------------------------
보도자료 PDF → 텍스트 + 페이지 이미지 + spec 뼈대 JSON

    python ingest_pdf.py <보도자료.pdf> [작업폴더]

산출물
    <작업폴더>/raw.txt          전체 텍스트 (조판 순서)
    <작업폴더>/page-N.png       페이지 이미지 (표 캡처용)
    <작업폴더>/spec_draft.json  build_press_ppt.js 입력 뼈대

meta(제목·보도일자·연월)는 1면에서 자동 추출하고,
내용요약 / 변경사항 / 정책흐름 / 의견은 raw.txt를 읽고 채운다.
------------------------------------------------------------------
"""
import json
import os
import re
import subprocess
import sys


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def extract_text(pdf):
    r = sh(f'pdftotext -layout "{pdf}" -')
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout
    try:
        import pypdf
        return "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(pdf).pages)
    except Exception:
        return ""


def guess_meta(text):
    meta = {"title": "", "source": "", "yearMonth": "", "team": "영업부", "fileTag": ""}

    # 보도시점 : 2026. 5. 12.(화)
    m = re.search(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*\(", text)
    if m:
        y, mo, d = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
        meta["yearMonth"] = f"{y}. {mo}"
        meta["source"] = f"국토교통부 보도({y[2:]}.{mo}.{d})"
        meta["fileTag"] = f"{y}{mo}{d}"

    # 제목: '보도자료' 이후 첫 굵은 제목 블록 (2줄까지)
    lines = [l.strip() for l in text.splitlines()]
    anchor = next((i for i, l in enumerate(lines) if "보도자료" in l), 0)
    cand = []
    for l in lines[anchor + 1: anchor + 20]:
        if not l or re.search(r"보도시점|배포|담당|^\-", l):
            continue
        if len(l) < 6:
            continue
        cand.append(l)
        if len(cand) == 2:
            break
    meta["title"] = " ".join(cand).strip()
    return meta


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    pdf = sys.argv[1]
    work = sys.argv[2] if len(sys.argv) > 2 else "pdf_work"
    os.makedirs(work, exist_ok=True)

    text = extract_text(pdf)
    with open(os.path.join(work, "raw.txt"), "w", encoding="utf-8") as f:
        f.write(text)

    sh(f'pdftoppm -png -r 150 "{pdf}" "{os.path.join(work, "page")}"')

    meta = guess_meta(text)
    draft = {
        "meta": meta,
        "summary": {"heading": "1. 내용요약", "items": ["<raw.txt 기준으로 5개 이내 작성>"]},
        "changes": {
            "heading": "2. 변경사항",
            "mode": "table",
            "imagePath": None,
            "columns": ["구  분", "종  전", "개  정"],
            "rows": [["<항목>", "<종전>", "<개정>"]],
        },
        "timeline": {
            "heading": "3. 관련 정책 흐름",
            "columns": ["발표 일자", "구분", "내용"],
            "colWidths": [1.42, 4.02, 5.03],
            "rows": [["<YY.MM.DD>", "<구분>", "<내용>"]],
            "highlightLastRow": True,
        },
        "opinion": ["<시장 영향 판단 1문장>", "<전망 1문장>"],
    }
    p = os.path.join(work, "spec_draft.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(draft, f, ensure_ascii=False, indent=2)

    print(f"텍스트   : {os.path.join(work, 'raw.txt')} ({len(text):,}자)")
    print(f"페이지   : {work}/page-*.png")
    print(f"spec 뼈대: {p}")
    print("\n[추정 meta]")
    for k, v in meta.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
