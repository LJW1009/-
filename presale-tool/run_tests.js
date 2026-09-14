const assert = require('assert');
const parser = require('./parser.js');
const cases = require('./test_cases.js');

function deepEqual(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; }
}

let pass = 0, fail = 0;
const failures = [];

for (const c of cases) {
  const fn = parser[c.fn];
  if (!fn) {
    fail++; failures.push({ id: c.id, desc: c.desc, reason: `함수 없음: ${c.fn}` });
    continue;
  }
  const args = c.args ? [c.input, ...c.args] : [c.input];
  let result;
  try {
    result = fn.apply(null, args);
  } catch (e) {
    fail++; failures.push({ id: c.id, desc: c.desc, reason: `예외 발생: ${e.message}` });
    continue;
  }

  let ok;
  if (c.expectFn) {
    ok = !!c.expectFn(result);
  } else {
    ok = deepEqual(result, c.expect);
  }

  if (ok) { pass++; }
  else {
    fail++;
    failures.push({ id: c.id, desc: c.desc, reason: '불일치', got: result, expect: c.expect });
  }
}

console.log(`[test_cases.js] ${pass}/${cases.length} 통과`);
if (failures.length) {
  console.log('--- 실패 목록 ---');
  for (const f of failures) {
    console.log(`\n[${f.id}] ${f.desc}\n  이유: ${f.reason}`);
    if (f.got !== undefined) console.log('  결과:', JSON.stringify(f.got));
    if (f.expect !== undefined) console.log('  기대:', JSON.stringify(f.expect));
  }
  process.exitCode = 1;
}
