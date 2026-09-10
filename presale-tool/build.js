/*
 * 최종 조합: app.html + SheetJS + parser.js + excel.js + logic.js -> dist/분양가정리.html
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const sheetjs = fs.readFileSync(path.join(dir, 'vendor/xlsx.full.min.js'), 'utf8');
const parser = fs.readFileSync(path.join(dir, 'parser.js'), 'utf8');
const excel = fs.readFileSync(path.join(dir, 'excel.js'), 'utf8');
const logic = fs.readFileSync(path.join(dir, 'logic.js'), 'utf8');
let html = fs.readFileSync(path.join(dir, 'app.html'), 'utf8');

// 개발용 script 태그 4개를 인라인 스크립트 하나로 치환
// 함수 형태의 replacer를 사용해야 함: sheetjs 번들 안의 "$&", "$1" 같은 리터럴 시퀀스가
// 문자열 replacer에서는 특수 치환 패턴으로 오인되어 원본 태그가 재삽입되는 문제가 있었음.
html = html.replace(
  /\s*<script src="vendor\/xlsx\.full\.min\.js"><\/script>\s*<script src="parser\.js"><\/script>\s*<script src="excel\.js"><\/script>\s*<script src="logic\.js"><\/script>\s*/,
  function () {
    return '\n<script>\n' + sheetjs + '\n</script>\n<script>\n' + parser + '\n' + excel + '\n' + logic + '\n</script>\n';
  }
);

const outDir = path.join(dir, 'dist');
fs.mkdirSync(outDir, { recursive: true });
// 주의: 기본 산출물 경로(dist/분양가정리.html)는 build_v65.js(현재 기본 UI) 전용이다.
// 레거시 UI는 별도 파일로 출력해 두 빌드가 서로 덮어쓰지 않게 한다.
const outPath = path.join(outDir, 'legacy_분양가정리.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('빌드 완료(레거시 UI):', outPath, '(' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB)');
