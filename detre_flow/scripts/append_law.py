#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
append_law.py — 기존 결재본에 법령 블록 '추가' (원본 편집 방식)

    python3 append_law.py <입력.xlsx> <추가내용.json> <출력.xlsx>

이미 작성된 당월 시트와 품의용 갑지를 다시 만들지 않고,
사용자가 편집한 행·서식을 그대로 둔 채 아래만 수행한다.

  1) 기존 법령 블록의 개정이유 문구 교체 (updateReason)
  2) 새 법령 블록을 시트 하단에 append
  3) 통보부서(A열) 병합 범위 확장

스타일 인덱스는 입력 파일에서 자동 탐지한다.
(사용자가 엑셀로 저장할 때마다 인덱스가 재배치되기 때문)
"""
import json
import math
import re
import sys
import zipfile
from xml.sax.saxutils import escape

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
W_MON = {"C": 94.125, "D": 96.375}
W_PUM = {"C": 35.75, "D": 35.75}


def est_lines(text, width, pt):
    if not text:
        return 1
    per = max(4.0, width * 11.0 / (2.0 * pt))
    n = 0
    for seg in str(text).split("\n"):
        cjk = sum(1 for ch in seg if ord(ch) > 0x2E00)
        w = cjk + (len(seg) - cjk) * 0.5
        n += max(1, math.ceil(w / per))
    return n


def cell(ref, style, text=None):
    if text is None:
        return '<c r="%s" s="%s"/>' % (ref, style)
    body = escape(str(text)).replace("\n", "&#10;")
    return ('<c r="%s" s="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
            % (ref, style, body))


def row_xml(idx, height, cells):
    return ('<row r="%d" ht="%s" customHeight="1">%s</row>'
            % (idx, height, "".join(cells)))


def parse_sheet(xml):
    """행 번호 → (스타일맵) / 마지막 행 / 병합목록 추출."""
    rows = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        n = int(m.group(1))
        rows[n] = dict(re.findall(r'<c r="([A-Z]+\d+)" s="(\d+)"', m.group(2)))
    merges = re.findall(r'<mergeCell ref="([^"]+)"/>', xml)
    return rows, merges


def detect_styles(rows, first_data_row):
    """본문 첫 블록에서 스타일 인덱스 자동 탐지."""
    r = first_data_row
    same = rows.get(r, {})
    chg = rows.get(r + 1, {})
    return same, chg


def replace_reason(xml, old_snippet, new_text):
    """개정이유 셀의 inlineStr 또는 sharedString 참조를 inlineStr로 치환."""
    # 기존 셀을 찾아 inlineStr로 교체
    def repl(m):
        ref, style = m.group(1), m.group(2)
        return cell(ref, style, new_text)
    return xml, repl


def main(src, jsn, out):
    payload = json.load(open(jsn, encoding="utf-8"))
    zin = zipfile.ZipFile(src)
    wb = zin.read("xl/workbook.xml").decode("utf-8")
    rels = zin.read("xl/_rels/workbook.xml.rels").decode("utf-8")

    def sheet_path(name):
        rid = re.search(r'<sheet name="%s"[^>]*r:id="(rId\d+)"' % re.escape(name), wb).group(1)
        tgt = re.search(r'Id="%s"[^>]*Target="([^"]+)"' % rid, rels).group(1)
        return "xl/" + tgt.lstrip("/")

    mon_name = payload["monthSheet"]
    mon_path = sheet_path(mon_name)
    pum_path = sheet_path("품의용 갑지")

    out_parts = {}

    for path, kind in ((mon_path, "mon"), (pum_path, "pum")):
        xml = zin.read(path).decode("utf-8")
        rows, merges = parse_sheet(xml)
        cfg = payload[kind]
        W = W_MON if kind == "mon" else W_PUM
        PT = 12.1 if kind == "mon" else 6.0
        LH = 15.95 if kind == "mon" else 9.3

        S = cfg["styles"]
        last = max(rows)
        r = last + 1
        new_rows = []
        new_merges = []
        blk_start = r

        for law in payload["laws"]:
            start = r
            for item in law["rows"]:
                k = item.get("kind", "same")
                sc = S["same_c"] if k == "same" else S["chg_c"]
                sd = S["same_d"] if k == "same" else S["chg_d"]
                n = max(est_lines(item.get("before"), W["C"], PT),
                        est_lines(item.get("after"), W["D"], PT))
                h = round(max(LH, n * LH), 2)
                title = None
                if r == start:
                    title = law["name"] + ("\n" + law["enforcement"]
                                           if law.get("enforcement") else "")
                cells = []
                if kind == "mon":
                    cells.append(cell("A%d" % r, S["dept"]))
                cells += [cell("B%d" % r, S["law"], title),
                          cell("C%d" % r, sc, item.get("before")),
                          cell("D%d" % r, sd, item.get("after"))]
                new_rows.append(row_xml(r, h, cells))
                r += 1
            if r - 1 > start:
                new_merges.append("B%d:B%d" % (start, r - 1))

            if law.get("reason"):
                n = est_lines(law["reason"], W["C"] + W["D"], PT)
                h = round(max(LH, n * LH * 0.99), 2)
                cells = []
                if kind == "mon":
                    cells.append(cell("A%d" % r, S["dept"]))
                cells += [cell("B%d" % r, S["reason_lbl"], "개정이유"),
                          cell("C%d" % r, S["reason_c"], law["reason"]),
                          cell("D%d" % r, S["reason_d"])]
                new_rows.append(row_xml(r, h, cells))
                new_merges.append("C%d:D%d" % (r, r))
                r += 1

        new_last = r - 1

        # 1) 개정이유 문구 교체
        upd = payload.get("updateReason")
        if upd:
            tgt_ref = cfg["reasonCell"]
            rn = int(re.search(r"\d+", tgt_ref).group())
            style = rows[rn][tgt_ref]
            xml = re.sub(r'<c r="%s" s="\d+"[^>]*(?:/>|>.*?</c>)' % tgt_ref,
                         cell(tgt_ref, style, upd), xml, count=1, flags=re.S)
            # 교체된 문구 길이에 맞춰 해당 행 높이 재산정
            nl = est_lines(upd, W["C"] + W["D"], PT)
            nh = round(max(LH, nl * LH * 0.99), 2)
            xml = re.sub(r'(<row r="%d")[^>]*?(>)' % rn,
                         r'\1 ht="%s" customHeight="1"\2' % nh, xml, count=1)

        # 2) 행 추가
        xml = xml.replace("</sheetData>", "".join(new_rows) + "</sheetData>")

        # 3) 병합 갱신 (통보부서 A열 확장 + 신규)
        if kind == "mon":
            # 통보부서 병합만 확장 (머리행 A4:A5 는 건드리지 않음)
            old_a = [m for m in merges if re.match(r"^A\d+:A\d+$", m)]
            if old_a:
                tgt = max(old_a, key=lambda m: int(m.split(":")[0][1:]))
                s0 = int(tgt.split(":")[0][1:])
                new_merges.append("A%d:A%d" % (s0, new_last))
                merges.remove(tgt)
                xml = xml.replace('<mergeCell ref="%s"/>' % tgt, "")
        allm = merges + new_merges
        xml = re.sub(r'<mergeCells count="\d+">.*?</mergeCells>',
                     '<mergeCells count="%d">%s</mergeCells>'
                     % (len(allm), "".join('<mergeCell ref="%s"/>' % m for m in allm)),
                     xml, flags=re.S)

        # 4) 1페이지 맞춤 (행 추가로 지면을 넘기지 않도록)
        if '<pageSetup' in xml:
            ps = re.search(r'<pageSetup[^>]*/>', xml).group(0)
            new_ps = ps
            if 'fitToHeight=' in new_ps:
                new_ps = re.sub(r'fitToHeight="\d+"', 'fitToHeight="1"', new_ps)
            else:
                new_ps = new_ps.replace('/>', ' fitToHeight="1"/>')
            if 'fitToWidth=' not in new_ps:
                new_ps = new_ps.replace('/>', ' fitToWidth="1"/>')
            new_ps = re.sub(r'\s*scale="\d+"', '', new_ps)
            xml = xml.replace(ps, new_ps)
        if '<pageSetUpPr' not in xml:
            xml = xml.replace('<sheetPr>', '<sheetPr><pageSetUpPr fitToPage="1"/>', 1)

        # 5) dimension 갱신
        col0 = "A" if kind == "mon" else "B"
        xml = re.sub(r'<dimension ref="[^"]+"/>',
                     '<dimension ref="%s1:D%d"/>' % (col0, new_last), xml)

        out_parts[path] = xml.encode("utf-8")
        print("[%s] %d행 추가 → 마지막 행 %d" % (
            mon_name if kind == "mon" else "품의용 갑지", len(new_rows), new_last))

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zo:
        for item in zin.infolist():
            zo.writestr(item, out_parts.get(item.filename, zin.read(item.filename)))
    zin.close()
    print("저장:", out)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
