#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_legal_sheet.py (rev.2)
------------------------------------------------------------------
행정절차 · 법규 변경 보고사항 최신화

    python3 build_legal_sheet.py <원본.xlsx> <입력.json> <출력.xlsx>

동작
  1. 당월 [YYYY.MM 영업계획팀] 탭 생성 (품의용 갑지 바로 뒤)
  2. [품의용 갑지] 탭을 당월 내용으로 교체 (6pt 축약 인쇄본)

원본 워크북을 openpyxl로 왕복 저장하지 않고 ZIP/XML을 직접 편집한다.
(과거 시트에 도형이 들어 있어 왕복 저장 시 유실되기 때문)
서식은 원본 styles.xml의 스타일 인덱스를 그대로 재사용한다.

rows[].kind
  head   : 조문 표제행    → 남색 볼드(151594) 양쪽
  same   : 변동 없는 조문 → 회색(444444) 양쪽
  change : 개정 대상      → 변경전 빨강(FF0000) / 변경후 파랑(0000CD)
------------------------------------------------------------------
"""
import json
import math
import re
import sys
import zipfile
from xml.sax.saxutils import escape

NSMAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NSR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# ── 원본 styles.xml 인덱스 fallback ──────────────────────────────
# ⚠ styles.xml 인덱스는 사용자가 엑셀에서 저장할 때마다 재배치된다.
#   아래 값은 입력 JSON에 "styles": {"mon": {...}, "pum": {...}} 가 없을 때만
#   쓰이는 fallback이며, 실제 실행 전에는 CLAUDE.md의 추출 스니펫으로
#   대상 파일에서 직접 뽑아 JSON에 넣는 것이 원칙이다.
#
#   2026-09-14, 실제 통합 보고서.xlsx(품의용 갑지 · 2026.07/08 영업계획팀)
#   에서 styles.xml의 폰트 색상·굵기·정렬까지 직접 읽어 아래 값으로 갱신함.
#   head_c/head_d(151594 남색 볼드)·same_c/d(444444 회색)·chg_c/d(FF0000/
#   0000CD)·impact_c/d(FF0000 볼드)까지 CLAUDE.md가 정의한 색상과 전부
#   일치함을 확인했다. 단 S_PUM_DEFAULT["impact_c"/"impact_d"]는 현재 품의용
#   갑지에 "당사와 관련없음"류 행이 남아있지 않아 대응하는 스타일을 찾지
#   못했다 — reason 스타일(볼드 회색)을 임시로 대입해두었으니, 실제로 쓰기
#   전에 반드시 결과 파일을 열어 눈으로 확인할 것.
S_MON_DEFAULT = {
    "title": "401", "title_c": "402",
    "h_a1": "403", "h_a2": "404", "h_b1": "405", "h_b2": "406",
    "h_c1": "395", "h_c2": "365",
    "dept": "400", "law": "407",
    "head_c": "387", "head_d": "377",
    "same_c": "396", "same_d": "397",
    "chg_c": "398", "chg_d": "399",
    "reason_lbl": "361", "reason_c": "408", "reason_d": "409",
    "impact_c": "413", "impact_d": "414",
}
S_PUM_DEFAULT = {
    "hdr": "390", "law": "410",
    "head_c": "391", "head_d": "391",
    "same_c": "391", "same_d": "391",
    "chg_c": "392", "chg_d": "393",
    "reason_lbl": "394", "reason_c": "411", "reason_d": "412",
    "impact_c": "411", "impact_d": "412",   # ⚠ 미확인 — reason 스타일 임시 대입
}

W_MON = {"C": 94.125, "D": 96.375}
W_PUM = {"C": 35.75, "D": 35.75}


def est_lines(text, width, pt):
    """열 너비·글자크기 대비 줄 수 (한글 1자 ≈ 2 x pt/11 문자폭)."""
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


def row(idx, height, cells):
    return ('<row r="%d" ht="%s" customHeight="1">%s</row>'
            % (idx, height, "".join(cells)))


# ── 월별 탭 ────────────────────────────────────────────────────
def build_month_sheet(payload, year, month, dept, S_MON):
    rows, merges = [], []

    def ht(n, pt=12.1):
        return round(max(15.0, n * pt * 1.32), 1)

    rows.append(row(1, 15, []))
    rows.append(row(2, 30, [
        cell("A2", S_MON["title"],
             "%s년 %s월 각 부서별 중요 행정절차 및 법규 변경사항" % (year, month)),
        cell("B2", S_MON["title_c"]), cell("C2", S_MON["title_c"]),
        cell("D2", S_MON["title_c"])]))
    merges.append("A2:D2")
    rows.append(row(3, 15, []))
    rows.append(row(4, 16.15, [
        cell("A4", S_MON["h_a1"], "통보부서"),
        cell("B4", S_MON["h_b1"], "법률명칭"),
        cell("C4", S_MON["h_c1"]), cell("D4", S_MON["h_c1"])]))
    rows.append(row(5, 16.15, [
        cell("A5", S_MON["h_a2"]), cell("B5", S_MON["h_b2"]),
        cell("C5", S_MON["h_c2"], "변경전"), cell("D5", S_MON["h_c2"], "변경 후")]))
    merges += ["A4:A5", "B4:B5"]

    if payload.get("noChanges"):
        rows.append(row(6, 46.2, [
            cell("A6", S_MON["dept"], dept),
            cell("B6", S_MON["law"], "%s년 %s월 법규 변경사항 없음" % (year[2:], month)),
            cell("C6", S_MON["law"]), cell("D6", S_MON["law"])]))
        merges.append("B6:D6")
        return rows, merges, 6

    first = 6
    r = first
    for law in payload["laws"]:
        start = r
        for item in law.get("rows", []):
            k = item.get("kind", "same")
            sc = {"head": S_MON["head_c"], "same": S_MON["same_c"],
                  "change": S_MON["chg_c"]}[k]
            sd = {"head": S_MON["head_d"], "same": S_MON["same_d"],
                  "change": S_MON["chg_d"]}[k]
            n = max(est_lines(item.get("before"), W_MON["C"], 12.1),
                    est_lines(item.get("after"), W_MON["D"], 12.1))
            title = None
            if r == start:
                title = law["name"] + ("\n" + law["enforcement"]
                                       if law.get("enforcement") else "")
            rows.append(row(r, ht(n), [
                cell("A%d" % r, S_MON["dept"], dept if r == first else None),
                cell("B%d" % r, S_MON["law"], title),
                cell("C%d" % r, sc, item.get("before")),
                cell("D%d" % r, sd, item.get("after"))]))
            r += 1
        end = r - 1
        if end > start:
            merges.append("B%d:B%d" % (start, end))

        blk = r
        if law.get("reason"):
            n = est_lines(law["reason"], W_MON["C"] + W_MON["D"], 12.0)
            rows.append(row(r, ht(n, 12.0), [
                cell("A%d" % r, S_MON["dept"]),
                cell("B%d" % r, S_MON["reason_lbl"], "개정이유"),
                cell("C%d" % r, S_MON["reason_c"], law["reason"]),
                cell("D%d" % r, S_MON["reason_d"])]))
            merges.append("C%d:D%d" % (r, r))
            r += 1
        if law.get("impact"):
            rows.append(row(r, 31.7, [
                cell("A%d" % r, S_MON["dept"]),
                cell("B%d" % r, S_MON["reason_lbl"]),
                cell("C%d" % r, S_MON["impact_c"], law["impact"]),
                cell("D%d" % r, S_MON["impact_d"])]))
            merges.append("C%d:D%d" % (r, r))
            r += 1
        if r - 1 > blk:
            merges.append("B%d:B%d" % (blk, r - 1))

    last = r - 1
    if last > first:
        merges.append("A%d:A%d" % (first, last))
    return rows, merges, last


# ── 품의용 갑지 ────────────────────────────────────────────────
def build_pum_sheet(payload, S_PUM):
    rows, merges = [], []

    def ht(n):
        return round(max(9.4, n * 9.3), 2)

    rows.append(row(1, 8.45, []))
    rows.append(row(2, 18, [
        cell("B2", S_PUM["hdr"], "구분"),
        cell("C2", S_PUM["hdr"], "현행"),
        cell("D2", S_PUM["hdr"], "개선")]))

    if payload.get("noChanges"):
        y, m = payload["yearMonth"].split("-")
        rows.append(row(3, 20, [
            cell("B3", S_PUM["law"], "%s년 %s월 법규 변경사항 없음" % (y[2:], m.zfill(2))),
            cell("C3", S_PUM["same_c"]), cell("D3", S_PUM["same_d"])]))
        merges.append("C3:D3")
        return rows, merges, 3

    r = 3
    for law in payload["laws"]:
        start = r
        for item in law.get("rows", []):
            k = item.get("kind", "same")
            sc = {"head": S_PUM["head_c"], "same": S_PUM["same_c"],
                  "change": S_PUM["chg_c"]}[k]
            sd = {"head": S_PUM["head_d"], "same": S_PUM["same_d"],
                  "change": S_PUM["chg_d"]}[k]
            n = max(est_lines(item.get("before"), W_PUM["C"], 6.0),
                    est_lines(item.get("after"), W_PUM["D"], 6.0))
            title = None
            if r == start:
                title = law["name"] + ("\n" + law["enforcement"]
                                       if law.get("enforcement") else "")
            rows.append(row(r, ht(n), [
                cell("B%d" % r, S_PUM["law"], title),
                cell("C%d" % r, sc, item.get("before")),
                cell("D%d" % r, sd, item.get("after"))]))
            r += 1
        end = r - 1
        if end > start:
            merges.append("B%d:B%d" % (start, end))

        blk = r
        if law.get("reason"):
            n = est_lines(law["reason"], W_PUM["C"] + W_PUM["D"], 6.0)
            rows.append(row(r, ht(n), [
                cell("B%d" % r, S_PUM["reason_lbl"], "개정이유"),
                cell("C%d" % r, S_PUM["reason_c"], law["reason"]),
                cell("D%d" % r, S_PUM["reason_d"])]))
            merges.append("C%d:D%d" % (r, r))
            r += 1
        if law.get("impact"):
            rows.append(row(r, 18.6, [
                cell("B%d" % r, S_PUM["reason_lbl"]),
                cell("C%d" % r, S_PUM["impact_c"], law["impact"]),
                cell("D%d" % r, S_PUM["impact_d"])]))
            merges.append("C%d:D%d" % (r, r))
            r += 1
        if r - 1 > blk:
            merges.append("B%d:B%d" % (blk, r - 1))
    return rows, merges, r - 1


# ── 시트 XML 조립 ──────────────────────────────────────────────
def sheet_xml(dim, cols, rows, merges, rid, scale, fit_h=0):
    mc = ""
    if merges:
        mc = ('<mergeCells count="%d">%s</mergeCells>'
              % (len(merges), "".join('<mergeCell ref="%s"/>' % m for m in merges)))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="%s" xmlns:r="%s">'
            '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
            '<dimension ref="%s"/>'
            '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>'
            '<sheetFormatPr defaultColWidth="9" defaultRowHeight="8.4"/>'
            '%s<sheetData>%s</sheetData>%s'
            '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" '
            'header="0.3" footer="0.3"/>'
            '<pageSetup paperSize="8" scale="%d" fitToHeight="%d" '
            'orientation="landscape" r:id="%s"/>'
            "</worksheet>"
            % (NSMAIN, NSR, dim, cols, "".join(rows), mc, scale, fit_h, rid))


COLS_MON = ('<cols>'
            '<col min="1" max="1" width="17.25" customWidth="1"/>'
            '<col min="2" max="2" width="31.75" customWidth="1"/>'
            '<col min="3" max="3" width="94.125" customWidth="1"/>'
            '<col min="4" max="4" width="96.375" customWidth="1"/>'
            "</cols>")
COLS_PUM = ('<cols>'
            '<col min="1" max="1" width="2.25" customWidth="1"/>'
            '<col min="2" max="2" width="10.25" customWidth="1"/>'
            '<col min="3" max="4" width="35.75" customWidth="1"/>'
            '<col min="5" max="5" width="6.875" customWidth="1"/>'
            "</cols>")


def main(src, jsn, out):
    payload = json.load(open(jsn, encoding="utf-8"))
    year, month = payload["yearMonth"].split("-")
    month = month.zfill(2)
    dept = payload.get("department", "영업계획팀")
    sheet_name = "%s.%s %s" % (year, month, dept)

    zin = zipfile.ZipFile(src)
    wb = zin.read("xl/workbook.xml").decode("utf-8")
    rels = zin.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    ct = zin.read("[Content_Types].xml").decode("utf-8")

    if 'name="%s"' % sheet_name in wb:
        raise SystemExit("[%s] 시트가 이미 있습니다." % sheet_name)

    styles = payload.get("styles", {})
    S_MON = dict(S_MON_DEFAULT, **styles.get("mon", {}))
    S_PUM = dict(S_PUM_DEFAULT, **styles.get("pum", {}))
    if not styles:
        print("⚠ 입력 JSON에 \"styles\" 키가 없어 기본값(fallback)을 사용합니다. "
              "styles.xml 인덱스가 최신 파일과 다를 수 있으니 CLAUDE.md의 추출 "
              "스니펫으로 직접 검증하세요.", file=sys.stderr)

    used = {int(m) for m in re.findall(r"worksheets/sheet(\d+)\.xml", rels)}
    new_no = max(used) + 1
    new_target = "worksheets/sheet%d.xml" % new_no
    new_rid = "rId%d" % (max(int(m) for m in re.findall(r'Id="rId(\d+)"', rels)) + 1)
    new_sid = max(int(m) for m in re.findall(r'sheetId="(\d+)"', wb)) + 1

    pum_rid = re.search(r'<sheet name="품의용 갑지"[^>]*r:id="(rId\d+)"', wb).group(1)
    pum_target = re.search(r'Id="%s"[^>]*Target="([^"]+)"' % pum_rid, rels).group(1)
    pum_path = "xl/" + pum_target.lstrip("/")
    tail = zin.read(pum_path).decode("utf-8").split("<pageSetup")[-1]
    m = re.search(r'r:id="(rId\d+)"', tail)
    pum_prid = m.group(1) if m else "rId1"

    mrows, mmerges, mlast = build_month_sheet(payload, year, month, dept, S_MON)
    prows, pmerges, plast = build_pum_sheet(payload, S_PUM)
    month_xml = sheet_xml("A1:D%d" % mlast, COLS_MON, mrows, mmerges, "rId1", 78)
    pum_xml = sheet_xml("B1:D%d" % plast, COLS_PUM, prows, pmerges, pum_prid, 100, fit_h=1)

    new_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
                'officeDocument/2006/relationships/printerSettings" '
                'Target="../printerSettings/printerSettings1.bin"/></Relationships>')

    anchor = re.search(r'(<sheet name="품의용 갑지"[^>]*/>)', wb).group(1)
    wb = wb.replace(anchor, anchor + '<sheet name="%s" sheetId="%d" r:id="%s"/>'
                    % (sheet_name, new_sid, new_rid), 1)
    rels = rels.replace("</Relationships>",
                        '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/'
                        'officeDocument/2006/relationships/worksheet" Target="%s"/>'
                        "</Relationships>" % (new_rid, new_target))
    ct = ct.replace("</Types>",
                    '<Override PartName="/xl/%s" ContentType="application/vnd.'
                    'openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
                    % new_target)

    replace = {
        "xl/workbook.xml": wb.encode("utf-8"),
        "xl/_rels/workbook.xml.rels": rels.encode("utf-8"),
        "[Content_Types].xml": ct.encode("utf-8"),
        pum_path: pum_xml.encode("utf-8"),
    }
    add = {
        "xl/" + new_target: month_xml.encode("utf-8"),
        "xl/worksheets/_rels/sheet%d.xml.rels" % new_no: new_rels.encode("utf-8"),
    }

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, replace.get(item.filename, zin.read(item.filename)))
        for name, data in add.items():
            zout.writestr(name, data)
    zin.close()

    print("[%s] 생성 — 본문 %d행" % (sheet_name, mlast))
    print("[품의용 갑지] 교체 — 본문 %d행" % plast)
    print("저장:", out)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
