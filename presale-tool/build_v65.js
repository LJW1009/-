/*
 * app_v65_source.html(사용자가 제공한, 인터페이스가 더 나은 버전)을 기반으로 최종 산출물을
 * 조립한다. 원본의 취약한 앵커 기반 파서(패턴 상수~extractMeta)를 제거하고, 그 자리에
 * 검증된 parser.js(48/78/84개 회귀 테스트 통과)와 adapter_v65.js를 삽입한다.
 *
 * parser.js는 window.parseAreaSection 등으로 이름을 직접 노출하므로, adapter_v65.js가
 * 이어서 실행되며 형태가 다른 parsePriceSection/extractMeta만 감싸 재정의한다. 나머지
 * (상태관리/렌더링/엑셀빌더/UI)는 원본 그대로 유지된다.
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const source = fs.readFileSync(path.join(dir, 'app_v65_source.html'), 'utf8');
const parser = fs.readFileSync(path.join(dir, 'parser.js'), 'utf8');
const adapter = fs.readFileSync(path.join(dir, 'adapter_v65.js'), 'utf8');

const OLD_COMMENT_START = '/* ═══════════════════════════════════════════════════════════════\n   PARSER v4';
const OLD_COMMENT_END = '═══════════════════════════════════════════════════════════════ */';
const START_MARK = '// ─── 패턴 상수 ─';
const END_MARK = '/* ══════════════════════════════════════════════════════════\n   STATE';

const oldCommentIdx = source.indexOf(OLD_COMMENT_START);
const oldCommentEndIdx = source.indexOf(OLD_COMMENT_END, oldCommentIdx);
const startIdx = source.indexOf(START_MARK);
const endIdx = source.indexOf(END_MARK);
if (oldCommentIdx === -1 || oldCommentEndIdx === -1 || startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  throw new Error('app_v65_source.html에서 파서 교체 구간을 찾지 못했습니다 (마커 확인 필요)');
}

// 1) 옛 파서를 설명하는 안내 주석(PARSER v4 ~) 제거
// 2) 그 사이 날짜 유틸(parseDate/fmtDate/dateSerial)은 유지
// 3) 옛 파서 본체(패턴 상수 ~ extractMeta)를 제거하고 그 자리에 새 파서+어댑터 삽입
const before =
  source.slice(0, oldCommentIdx) +
  source.slice(oldCommentEndIdx + OLD_COMMENT_END.length, startIdx);
const after = source.slice(endIdx);

const replacement =
  '// ─── 파서 (parser.js: 헤더 컬럼맵 기반, 84개 회귀 테스트로 검증됨) ──────\n' +
  parser +
  '\n// ─── 어댑터: 이 앱이 기대하는 호출 규약으로 변환 ──────────────────────\n' +
  adapter +
  '\n\n';

const result = before + replacement + after;

const outDir = path.join(dir, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '분양가정리.html');
fs.writeFileSync(outPath, result, 'utf8');
console.log('빌드 완료 (v6.5 기반):', outPath, '(' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB)');
