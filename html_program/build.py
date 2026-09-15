#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — law_update_program.html 조립 스크립트

    python3 html_program/build.py

detre_flow/assets(아이콘·로고)를 base64로 인코딩하고, detre_flow의
pptxgenjs 번들(JSZip 포함)과 이 폴더의 shell.html/app.js/ppt.js/ui.js를
하나로 합쳐 저장소 루트에 단일 HTML 파일을 생성한다.

사전 준비: detre_flow에서 `npm install`을 한 번 실행해 두어야
node_modules/pptxgenjs/dist/pptxgen.bundle.js 가 존재한다.
"""
import base64
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_DIR = os.path.dirname(os.path.abspath(__file__))
DETRE = os.path.join(ROOT, "detre_flow")
ICON_DIR = os.path.join(DETRE, "assets", "icons")
LOGO_PATH = os.path.join(DETRE, "assets", "cover_logo.png")
BUNDLE_PATH = os.path.join(DETRE, "node_modules", "pptxgenjs", "dist", "pptxgen.bundle.js")
OUT_PATH = os.path.join(ROOT, "law_update_program.html")


def b64_data_uri(path, mime="image/png"):
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def build_assets_js():
    icons = {}
    for fname in sorted(os.listdir(ICON_DIR)):
        if fname.endswith(".png"):
            icons[fname[:-4]] = b64_data_uri(os.path.join(ICON_DIR, fname))
    logo = b64_data_uri(LOGO_PATH)
    return "const ICONS = " + json.dumps(icons) + ";\nconst LOGO_DATA = " + json.dumps(logo) + ";\n"


def main():
    if not os.path.exists(BUNDLE_PATH):
        raise SystemExit(
            "pptxgen.bundle.js가 없습니다. 먼저 'cd detre_flow && npm install'을 실행하세요.\n"
            "찾은 경로: " + BUNDLE_PATH
        )

    bundle = open(BUNDLE_PATH, encoding="utf-8").read()
    assets_js = build_assets_js()
    app_js = open(os.path.join(HTML_DIR, "app.js"), encoding="utf-8").read()
    ppt_js = open(os.path.join(HTML_DIR, "ppt.js"), encoding="utf-8").read()
    ui_js = open(os.path.join(HTML_DIR, "ui.js"), encoding="utf-8").read()
    shell = open(os.path.join(HTML_DIR, "shell.html"), encoding="utf-8").read()

    out = shell
    out = out.replace("/*__PPTXGEN_BUNDLE__*/", bundle)
    out = out.replace("/*__ASSETS__*/", assets_js)
    out = out.replace("/*__APP_JS__*/", app_js)
    out = out.replace("/*__PPT_JS__*/", ppt_js)
    out = out.replace("/*__UI_JS__*/", ui_js)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"생성: {OUT_PATH} ({len(out) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
