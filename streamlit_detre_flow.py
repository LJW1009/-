import streamlit as st
import zipfile
import re
import io
import os
import json
import uuid
import shutil
import subprocess
import tempfile
from datetime import datetime

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
DETRE = os.path.join(REPO_ROOT, "detre_flow")
SCRIPTS = os.path.join(DETRE, "scripts")
ICON_DIR = os.path.join(DETRE, "assets", "icons")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DEFAULT_DEPT = "영업계획팀"

st.set_page_config(page_title="법규 최신화 프로그램", layout="wide", page_icon="📜")
st.title("📜 법규 최신화 프로그램")
st.caption("실제 detre_flow 파이프라인(build_legal_sheet.py / append_law.py / build_press_ppt.js / qa_layout.py)을 그대로 호출합니다. 값을 입력하면 결과 파일이 바로 생성됩니다.")

menu = st.sidebar.radio(
    "메뉴",
    ["📗 법규 변경 보고사항 (Excel)", "📙 보도자료 요약 PPT (3장 고정)"],
)


# ============================================================
# 공통 유틸
# ============================================================
def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def node_ready():
    return shutil.which("node") is not None and os.path.isdir(os.path.join(DETRE, "node_modules"))


def sheet_xml_path(zf, wb_xml, rels_xml, name):
    m = re.search(r'<sheet name="%s"[^>]*r:id="(rId\d+)"' % re.escape(name), wb_xml)
    if not m:
        return None
    rid = m.group(1)
    m2 = re.search(r'Id="%s"[^>]*Target="([^"]+)"' % rid, rels_xml)
    if not m2:
        return None
    return "xl/" + m2.group(1).lstrip("/")


def list_sheets(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as z:
        wb = z.read("xl/workbook.xml").decode("utf-8")
    return re.findall(r'<sheet name="([^"]+)"', wb)


def month_tabs(sheets, dept=DEFAULT_DEPT):
    pat = re.compile(r"^(\d{4})\.(\d{2}) " + re.escape(dept))
    found = [(s, pat.match(s)) for s in sheets]
    found = [(s, m.group(1) + "-" + m.group(2)) for s, m in found if m]
    found.sort(key=lambda t: t[1], reverse=True)
    return found  # [(sheet_name, "YYYY-MM"), ...] newest first


def extract_cellxfs_index(xlsx_path, sheet_name):
    """해당 시트에서 실제 사용 중인 (행번호 → {셀좌표: 스타일인덱스}) 맵 반환.
    자기종료 <row .../> (빈 행)이 섞여 있으므로 정규식이 아닌 XML 파서로 읽는다."""
    from lxml import etree
    with zipfile.ZipFile(xlsx_path) as z:
        wb = z.read("xl/workbook.xml").decode("utf-8")
        rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
        path = sheet_xml_path(z, wb, rels, sheet_name)
        if path is None:
            return None
        root = etree.fromstring(z.read(path))
    out = {}
    for row in root.iter(NS + "row"):
        cells = {c.get("r"): c.get("s") for c in row.iter(NS + "c") if c.get("s") is not None}
        out[int(row.get("r"))] = cells
    return out


def font_signature(xlsx_path, style_idx):
    """styles.xml에서 특정 cellXfs 인덱스의 폰트 색상/굵기/정렬을 읽어온다 (검증용 표시)."""
    from lxml import etree
    with zipfile.ZipFile(xlsx_path) as z:
        styles = etree.fromstring(z.read("xl/styles.xml"))
    fonts_el = styles.find(NS + "fonts")
    fonts = []
    for f in fonts_el:
        color = f.find(NS + "color")
        rgb = color.get("rgb") if color is not None else None
        bold = f.find(NS + "b") is not None
        sz = f.find(NS + "sz")
        sz = sz.get("val") if sz is not None else None
        fonts.append({"rgb": rgb, "bold": bold, "sz": sz})
    cellxfs = list(styles.find(NS + "cellXfs"))
    idx = int(style_idx)
    if idx >= len(cellxfs):
        return None
    xf = cellxfs[idx]
    fid = int(xf.get("fontId", 0))
    return fonts[fid] if fid < len(fonts) else None


def new_uid():
    return uuid.uuid4().hex[:8]


# ============================================================
# 1. 법규 변경 보고사항 (Excel)
# ============================================================
if menu.startswith("📗"):
    st.subheader("법규 변경 보고사항 — 통합 보고서.xlsx 갱신")

    up = st.file_uploader("원본 통합 보고서.xlsx 업로드 (필수)", type=["xlsx"])

    if up is None:
        st.info("원본 파일을 올리면 시트 목록과 최신 월, 현재 서식(styles.xml) 인덱스를 자동으로 읽어옵니다.")
    else:
        tmpdir = tempfile.mkdtemp(prefix="detre_")
        src_path = os.path.join(tmpdir, "원본.xlsx")
        with open(src_path, "wb") as f:
            f.write(up.getvalue())

        try:
            sheets = list_sheets(src_path)
        except Exception as e:
            st.error(f"엑셀 파일을 읽는 중 오류: {e}")
            sheets = []

        if "품의용 갑지" not in sheets:
            st.error("'품의용 갑지' 시트를 찾을 수 없습니다. 올바른 원본 파일인지 확인하세요.")
        else:
            tabs = month_tabs(sheets)
            latest_sheet, latest_ym = tabs[0] if tabs else (None, None)
            st.success(f"시트 {len(sheets)}개 확인. 최신 월 탭: **{latest_sheet or '없음'}**")

            mode = st.radio(
                "작업 종류",
                ["🆕 신규 월 탭 생성 (build_legal_sheet.py)", "➕ 기존 탭에 법령 추가 (append_law.py)"],
                horizontal=True,
            )

            with st.expander("🔍 현재 파일에서 자동 추출한 서식(styles.xml) 미리보기", expanded=False):
                st.caption("엑셀에서 파일을 열고 저장할 때마다 styles.xml 인덱스가 바뀌므로, 매번 이 파일 기준으로 새로 추출합니다.")
                if latest_sheet:
                    row_styles = extract_cellxfs_index(src_path, latest_sheet)
                    r6 = (row_styles or {}).get(6, {})
                    st.write(f"`{latest_sheet}` 첫 데이터 행(6번) 스타일 인덱스:", r6)
                    preview_rows = []
                    for label, ref in [("변경없음(C)", "C6"), ("변경있음(D, 있다면)", "D7")]:
                        idx = r6.get(ref) or (row_styles.get(7) or {}).get(ref)
                        if idx:
                            sig = font_signature(src_path, idx)
                            preview_rows.append({"항목": label, "style": idx, "색상": sig and sig["rgb"],
                                                  "굵게": sig and sig["bold"]})
                    if preview_rows:
                        st.table(preview_rows)

            st.markdown("---")

            if mode.startswith("🆕"):
                col1, col2 = st.columns(2)
                with col1:
                    default_next = ""
                    if latest_ym:
                        y, m = map(int, latest_ym.split("-"))
                        m += 1
                        if m > 12:
                            m = 1
                            y += 1
                        default_next = f"{y}-{m:02d}"
                    year_month = st.text_input("대상 연월 (YYYY-MM)", default_next)
                with col2:
                    department = st.text_input("관련 부서", DEFAULT_DEPT)
                no_changes = st.checkbox("이번 달 법규 변경사항 없음")
                target_sheet_for_style = latest_sheet
            else:
                if not tabs:
                    st.warning("기존 'YYYY.MM 영업계획팀' 형식의 탭이 없습니다.")
                    target_sheet_for_style = None
                else:
                    sel = st.selectbox("법령을 추가할 기존 월 탭", [s for s, _ in tabs])
                    target_sheet_for_style = sel
                no_changes = False

            st.markdown("### 법령 목록")
            if "laws" not in st.session_state:
                st.session_state.laws = []

            if st.button("➕ 법령 추가"):
                st.session_state.laws.append({
                    "uid": new_uid(), "name": "", "enforcement": "", "reason": "",
                    "no_impact": False, "impact": "", "rows": [],
                })
                st.rerun()

            for li, law in enumerate(st.session_state.laws):
                with st.expander(f"법령 {li + 1}: {law['name'] or '(이름 미입력)'}", expanded=True):
                    c1, c2 = st.columns([3, 2])
                    law["name"] = c1.text_input("법률명칭", law["name"], key=f"name_{law['uid']}")
                    law["enforcement"] = c2.text_input(
                        "시행일 · 법령번호", law["enforcement"], key=f"enf_{law['uid']}",
                        placeholder="[시행 2026. 9. 1] [법률 제00000호, 2026. 8. 1, 일부개정]")
                    law["reason"] = st.text_area("개정이유", law["reason"], key=f"reason_{law['uid']}", height=80)

                    law["no_impact"] = st.checkbox(
                        "당사와 관련없음", law.get("no_impact", False), key=f"noimpact_{law['uid']}")
                    if not law["no_impact"]:
                        law["impact"] = st.text_area(
                            "당사 관련성(선택, 비우면 impact 행을 만들지 않음)",
                            law.get("impact", ""), key=f"impact_{law['uid']}", height=60)
                    else:
                        law["impact"] = "당사와 관련없음"

                    st.markdown("**조문 행**")
                    if st.button("➕ 조문 행 추가", key=f"addrow_{law['uid']}"):
                        law["rows"].append({"uid": new_uid(), "kind": "same", "before": "", "after": ""})
                        st.rerun()

                    for ri, row in enumerate(law["rows"]):
                        rc1, rc2, rc3, rc4 = st.columns([1, 3, 3, 0.6])
                        row["kind"] = rc1.selectbox(
                            "kind", ["head", "same", "change"],
                            index=["head", "same", "change"].index(row["kind"]),
                            key=f"kind_{row['uid']}", label_visibility="collapsed")
                        row["before"] = rc2.text_area(
                            "변경전", row["before"], key=f"before_{row['uid']}", height=70,
                            label_visibility="collapsed", placeholder="변경전 (예: 1.~5. (생 략), <신 설>)")
                        row["after"] = rc3.text_area(
                            "변경후", row["after"], key=f"after_{row['uid']}", height=70,
                            label_visibility="collapsed", placeholder="변경 후")
                        if rc4.button("🗑", key=f"delrow_{row['uid']}"):
                            law["rows"].remove(row)
                            st.rerun()

                    if st.button("🗑 이 법령 삭제", key=f"dellaw_{law['uid']}"):
                        st.session_state.laws.remove(law)
                        st.rerun()

            st.markdown("---")

            if st.button("🚀 엑셀 생성", type="primary", use_container_width=True):
                if mode.startswith("🆕") and not no_changes and not st.session_state.laws:
                    st.error("법령을 1개 이상 추가하거나 '변경사항 없음'을 체크하세요.")
                elif not mode.startswith("🆕") and not st.session_state.laws:
                    st.error("추가할 법령을 1개 이상 입력하세요.")
                elif not target_sheet_for_style:
                    st.error("스타일을 추출할 기준 시트를 찾을 수 없습니다.")
                else:
                    laws_payload = []
                    for law in st.session_state.laws:
                        laws_payload.append({
                            "name": law["name"],
                            "enforcement": law["enforcement"],
                            "reason": law["reason"],
                            "impact": law["impact"] if law["impact"] else None,
                            "rows": [{"kind": r["kind"], "before": r["before"], "after": r["after"]}
                                     for r in law["rows"]],
                        })

                    pum_styles = extract_cellxfs_index(src_path, "품의용 갑지")
                    mon_styles = extract_cellxfs_index(src_path, target_sheet_for_style)

                    def pick(styles_map, ref):
                        rn = int(re.search(r"\d+", ref).group())
                        return (styles_map.get(rn) or {}).get(ref)

                    out_path = os.path.join(tmpdir, "출력.xlsx")

                    if mode.startswith("🆕"):
                        styles = {
                            "mon": {
                                "title": pick(mon_styles, "A2"), "title_c": pick(mon_styles, "B2"),
                                "h_a1": pick(mon_styles, "A4"), "h_a2": pick(mon_styles, "A5"),
                                "h_b1": pick(mon_styles, "B4"), "h_b2": pick(mon_styles, "B5"),
                                "h_c1": pick(mon_styles, "C4"), "h_c2": pick(mon_styles, "C5"),
                                "dept": pick(mon_styles, "A6"), "law": pick(mon_styles, "B6"),
                                "head_c": "387", "head_d": "377",
                                "same_c": pick(mon_styles, "C6") or "396",
                                "same_d": pick(mon_styles, "D6") or "397",
                                "chg_c": pick(mon_styles, "C7") or "398",
                                "chg_d": pick(mon_styles, "D7") or "399",
                                "reason_lbl": pick(mon_styles, "B8") or "361",
                                "reason_c": pick(mon_styles, "C8") or "408",
                                "reason_d": pick(mon_styles, "D8") or "409",
                                "impact_c": "413", "impact_d": "414",
                            },
                            "pum": {
                                "hdr": pick(pum_styles, "B2"), "law": pick(pum_styles, "B3"),
                                "head_c": "391", "head_d": "391",
                                "same_c": pick(pum_styles, "C3") or "391",
                                "same_d": pick(pum_styles, "D3") or "391",
                                "chg_c": pick(pum_styles, "C4") or "392",
                                "chg_d": pick(pum_styles, "D4") or "393",
                                "reason_lbl": pick(pum_styles, "B5") or "394",
                                "reason_c": pick(pum_styles, "C5") or "411",
                                "reason_d": pick(pum_styles, "D5") or "412",
                                "impact_c": pick(pum_styles, "C5") or "411",
                                "impact_d": pick(pum_styles, "D5") or "412",
                            },
                        }
                        payload = {
                            "yearMonth": year_month, "department": department,
                            "noChanges": no_changes, "laws": laws_payload, "styles": styles,
                        }
                        spec_path = os.path.join(tmpdir, "spec.json")
                        json.dump(payload, open(spec_path, "w", encoding="utf-8"), ensure_ascii=False)
                        code, out, err = run(["python3", os.path.join(SCRIPTS, "build_legal_sheet.py"),
                                               src_path, spec_path, out_path])
                    else:
                        styles = {
                            "mon": {
                                "dept": pick(mon_styles, "A6") or "400",
                                "law": pick(mon_styles, "B6") or "407",
                                "same_c": pick(mon_styles, "C6") or "396",
                                "same_d": pick(mon_styles, "D6") or "397",
                                "chg_c": pick(mon_styles, "C7") or "398",
                                "chg_d": pick(mon_styles, "D7") or "399",
                                "reason_lbl": pick(mon_styles, "B8") or "361",
                                "reason_c": pick(mon_styles, "C8") or "408",
                                "reason_d": pick(mon_styles, "D8") or "409",
                            },
                            "pum": {
                                "law": pick(pum_styles, "B3") or "410",
                                "same_c": pick(pum_styles, "C3") or "391",
                                "same_d": pick(pum_styles, "D3") or "391",
                                "chg_c": pick(pum_styles, "C4") or "392",
                                "chg_d": pick(pum_styles, "D4") or "393",
                                "reason_lbl": pick(pum_styles, "B5") or "394",
                                "reason_c": pick(pum_styles, "C5") or "411",
                                "reason_d": pick(pum_styles, "D5") or "412",
                            },
                        }
                        payload = {
                            "monthSheet": target_sheet_for_style,
                            "mon": {"reasonCell": "C8", "styles": styles["mon"]},
                            "pum": {"reasonCell": "C5", "styles": styles["pum"]},
                            "laws": laws_payload,
                        }
                        spec_path = os.path.join(tmpdir, "spec.json")
                        json.dump(payload, open(spec_path, "w", encoding="utf-8"), ensure_ascii=False)
                        code, out, err = run(["python3", os.path.join(SCRIPTS, "append_law.py"),
                                               src_path, spec_path, out_path])

                    st.code((out or "") + (err or ""), language="text")

                    if code != 0 or not os.path.exists(out_path):
                        st.error("생성 실패. 위 로그를 확인하세요.")
                    else:
                        with zipfile.ZipFile(src_path) as a, zipfile.ZipFile(out_path) as b:
                            na, nb = set(a.namelist()), set(b.namelist())
                            deleted = sorted(na - nb)
                            changed = [n for n in sorted(na & nb) if a.read(n) != b.read(n)]
                            drawings_kept = all(n in nb for n in na if "drawing" in n)
                        st.markdown("**원본 보존 검증**")
                        vc1, vc2, vc3 = st.columns(3)
                        vc1.metric("삭제된 파트", len(deleted), delta=None,
                                   delta_color="off" if not deleted else "inverse")
                        vc2.metric("변경된 파트", len(changed))
                        vc3.metric("도형(drawing) 유지", "OK" if drawings_kept else "손실!")
                        if deleted or not drawings_kept:
                            st.error("⚠ 원본이 손상되었을 수 있습니다. 결과 파일을 열기 전에 꼭 확인하세요.")
                        elif len(changed) > 4:
                            st.warning(f"변경된 파트가 {len(changed)}개로 예상(4개 이하)보다 많습니다: {changed}")
                        else:
                            st.success("정상 — 도형 100% 유지, 변경 파트도 예상 범위 내.")

                        with open(out_path, "rb") as f:
                            st.download_button(
                                "⬇️ 결과 엑셀 다운로드", data=f.read(),
                                file_name=f"통합보고서_{year_month if mode.startswith('🆕') else target_sheet_for_style}.xlsx",
                                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                use_container_width=True,
                            )


# ============================================================
# 2. 보도자료 요약 PPT (3장 고정, build_press_ppt.js)
# ============================================================
else:
    st.subheader("보도자료 요약 PPT — 3장 고정 구성 (build_press_ppt.js)")

    if not node_ready():
        st.error(
            "node 또는 detre_flow/node_modules가 없습니다. 이 프로그램을 쓰기 전에 "
            "`cd detre_flow && npm install` 을 먼저 실행하세요."
        )

    st.caption("텍스트에 `[[강조]]`는 파랑, `{{강조}}`는 파랑+노랑 형광으로 렌더링됩니다.")

    st.markdown("### 표지")
    c1, c2, c3 = st.columns(3)
    title = c1.text_input("제목", placeholder="예: 주택 신속공급 방안 & 금융 종합대책")
    year_month = c2.text_input("연월", datetime.now().strftime("%Y. %m"))
    team = c3.text_input("팀", "영업부")
    source = st.text_input("출처", placeholder="예: 국토교통부 보도(26.08.13)")

    st.markdown("### 1. 내용요약")
    if "summary_items" not in st.session_state:
        st.session_state.summary_items = [""]
    for i in range(len(st.session_state.summary_items)):
        st.session_state.summary_items[i] = st.text_area(
            f"요약 항목 {i + 1}", st.session_state.summary_items[i], key=f"sum_{i}", height=60)
    bc1, bc2 = st.columns(2)
    if bc1.button("➕ 요약 항목 추가") and len(st.session_state.summary_items) < 5:
        st.session_state.summary_items.append("")
        st.rerun()
    if bc2.button("➖ 마지막 항목 삭제") and len(st.session_state.summary_items) > 1:
        st.session_state.summary_items.pop()
        st.rerun()

    st.markdown("### 2. 변경사항 (표)")
    cc1, cc2, cc3 = st.columns(3)
    col_a = cc1.text_input("열1 제목", "구  분")
    col_b = cc2.text_input("열2 제목", "종  전")
    col_c = cc3.text_input("열3 제목", "개  정")
    if "changes_rows" not in st.session_state:
        st.session_state.changes_rows = [["", "", ""]]
    for i, row in enumerate(st.session_state.changes_rows):
        rc1, rc2, rc3, rc4 = st.columns([2, 3, 3, 0.6])
        row[0] = rc1.text_input(col_a, row[0], key=f"chg_a_{i}", label_visibility="collapsed")
        row[1] = rc2.text_area(col_b, row[1], key=f"chg_b_{i}", height=60, label_visibility="collapsed")
        row[2] = rc3.text_area(col_c, row[2], key=f"chg_c_{i}", height=60, label_visibility="collapsed")
        if rc4.button("🗑", key=f"chg_del_{i}") and len(st.session_state.changes_rows) > 1:
            st.session_state.changes_rows.pop(i)
            st.rerun()
    if st.button("➕ 변경사항 행 추가"):
        st.session_state.changes_rows.append(["", "", ""])
        st.rerun()

    st.markdown("### 3. 관련 정책 흐름 (표)")
    if "timeline_rows" not in st.session_state:
        st.session_state.timeline_rows = [["", "", ""]]
    for i, row in enumerate(st.session_state.timeline_rows):
        rc1, rc2, rc3, rc4 = st.columns([2, 2, 5, 0.6])
        row[0] = rc1.text_input("일자", row[0], key=f"tl_a_{i}", label_visibility="collapsed")
        row[1] = rc2.text_input("구분", row[1], key=f"tl_b_{i}", label_visibility="collapsed")
        row[2] = rc3.text_area("내용", row[2], key=f"tl_c_{i}", height=60, label_visibility="collapsed")
        if rc4.button("🗑", key=f"tl_del_{i}") and len(st.session_state.timeline_rows) > 1:
            st.session_state.timeline_rows.pop(i)
            st.rerun()
    if st.button("➕ 흐름 행 추가"):
        st.session_state.timeline_rows.append(["", "", ""])
        st.rerun()

    st.markdown("### 4. 종합정리 (인포그래픽, 선택)")
    use_info = st.checkbox("인포그래픽 포함")
    infographic = None
    if use_info:
        ic1, ic2 = st.columns(2)
        with ic1:
            st.markdown("**종전**")
            b_label = st.text_input("종전 라벨", "종  전")
            b_value = st.text_input("종전 값")
            b_caption = st.text_input("종전 캡션(선택)")
        with ic2:
            st.markdown("**변경**")
            a_label = st.text_input("변경 라벨", "변  경")
            a_value = st.text_input("변경 값")
            a_caption = st.text_input("변경 캡션(선택)")

        icons = sorted(f[:-4] for f in os.listdir(ICON_DIR)) if os.path.isdir(ICON_DIR) else []
        if "info_cards" not in st.session_state:
            st.session_state.info_cards = []
        if st.button("➕ 카드 추가") and len(st.session_state.info_cards) < 5:
            st.session_state.info_cards.append({"uid": new_uid(), "icon": icons[0] if icons else "check",
                                                 "title": "", "line1": "", "line2": ""})
            st.rerun()
        for card in st.session_state.info_cards:
            k1, k2, k3, k4, k5 = st.columns([1.5, 2, 2, 2, 0.6])
            card["icon"] = k1.selectbox("아이콘", icons, index=icons.index(card["icon"]) if card["icon"] in icons else 0,
                                         key=f"icon_{card['uid']}")
            card["title"] = k2.text_input("카드 제목", card["title"], key=f"ctitle_{card['uid']}")
            card["line1"] = k3.text_input("줄1", card["line1"], key=f"cl1_{card['uid']}")
            card["line2"] = k4.text_input("줄2", card["line2"], key=f"cl2_{card['uid']}")
            if k5.button("🗑", key=f"cdel_{card['uid']}"):
                st.session_state.info_cards.remove(card)
                st.rerun()

    st.markdown("### 의견 바 (하단)")
    if "opinion_lines" not in st.session_state:
        st.session_state.opinion_lines = [""]
    for i in range(len(st.session_state.opinion_lines)):
        st.session_state.opinion_lines[i] = st.text_area(
            f"의견 {i + 1}", st.session_state.opinion_lines[i], key=f"op_{i}", height=60)
    oc1, oc2 = st.columns(2)
    if oc1.button("➕ 의견 추가") and len(st.session_state.opinion_lines) < 3:
        st.session_state.opinion_lines.append("")
        st.rerun()
    if oc2.button("➖ 마지막 의견 삭제") and len(st.session_state.opinion_lines) > 1:
        st.session_state.opinion_lines.pop()
        st.rerun()

    st.markdown("---")

    if st.button("🚀 PPT 생성", type="primary", use_container_width=True, disabled=not node_ready()):
        if not title:
            st.error("제목은 필수입니다.")
        else:
            tmpdir = tempfile.mkdtemp(prefix="detre_press_")
            file_tag = re.sub(r"[^0-9A-Za-z가-힣_]+", "_", f"{datetime.now().strftime('%Y%m%d')}_{title}")[:60]

            spec = {
                "meta": {
                    "title": title, "source": source, "yearMonth": year_month,
                    "team": team, "fileTag": file_tag,
                },
                "summary": {"heading": "1. 내용요약",
                             "items": [x for x in st.session_state.summary_items if x.strip()]},
                "changes": {
                    "heading": "2. 변경사항",
                    "columns": [col_a, col_b, col_c],
                    "rows": [r for r in st.session_state.changes_rows if any(c.strip() for c in r)],
                },
                "timeline": {
                    "heading": "3. 관련 정책 흐름",
                    "columns": ["일자", "구분", "내용"],
                    "rows": [r for r in st.session_state.timeline_rows if any(c.strip() for c in r)],
                },
                "opinion": [x for x in st.session_state.opinion_lines if x.strip()],
            }
            if use_info:
                spec["infographic"] = {
                    "heading": "4. 종합정리",
                    "before": {"label": b_label, "value": b_value, "caption": b_caption},
                    "after": {"label": a_label, "value": a_value, "caption": a_caption},
                    "cards": [{"icon": c["icon"], "title": c["title"],
                               "lines": [x for x in (c["line1"], c["line2"]) if x]}
                              for c in st.session_state.get("info_cards", [])],
                }

            spec_path = os.path.join(tmpdir, "spec.json")
            json.dump(spec, open(spec_path, "w", encoding="utf-8"), ensure_ascii=False)

            out_path = os.path.join(tmpdir, f"{file_tag}_영업계획팀.pptx")
            code, out, err = run(["node", os.path.join(SCRIPTS, "build_press_ppt.js"), spec_path, out_path],
                                  cwd=DETRE)
            st.code((out or "") + (err or ""), language="text")

            if code != 0 or not os.path.exists(out_path):
                st.error("PPT 생성 실패. 위 로그를 확인하세요.")
            else:
                qcode, qout, qerr = run(["python3", os.path.join(SCRIPTS, "qa_layout.py"), out_path])
                with st.expander("🔍 qa_layout.py 검수 결과", expanded=True):
                    st.code((qout or "") + (qerr or ""), language="text")

                with open(out_path, "rb") as f:
                    st.download_button(
                        "⬇️ 결과 PPT 다운로드", data=f.read(), file_name=os.path.basename(out_path),
                        mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                        use_container_width=True,
                    )

st.sidebar.markdown("---")
st.sidebar.caption("실제 원본 파일을 다루므로, 생성 후에도 결과 파일을 열어 눈으로 한 번 더 확인하세요.")
