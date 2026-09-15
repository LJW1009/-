#!/usr/bin/env bash
# make_ai_bundle.sh — 새 AI 세션에 올릴 수 있는 zip 번들 생성
#
#   ./make_ai_bundle.sh
#
# detre_flow/(node_modules, output 제외)와 html_program/(node_modules,
# package-lock.json 제외)을 묶어 dist/법규최신화_AI세션용_번들.zip 을
# 만든다. dist/는 빌드 산출물이라 git에 커밋하지 않는다(.gitignore 참고).
set -euo pipefail
cd "$(dirname "$0")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/detre_flow" "$STAGE/html_program"
cp -r detre_flow/. "$STAGE/detre_flow/"
rm -rf "$STAGE/detre_flow/node_modules" "$STAGE/detre_flow/output"
cp -r html_program/. "$STAGE/html_program/"
rm -rf "$STAGE/html_program/node_modules" "$STAGE/html_program/package-lock.json"

mkdir -p dist
OUT="dist/법규최신화_AI세션용_번들.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -rq -X "$OLDPWD/$OUT" detre_flow html_program -x "*.DS_Store")

echo "생성: $OUT ($(du -h "$OUT" | cut -f1))"
