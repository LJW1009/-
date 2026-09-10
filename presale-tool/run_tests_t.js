const parser = require('./parser.js');
const cases = require('./test_cases_t.js');

let pass = 0, fail = 0;
const failures = [];

for (const c of cases) {
  let ok = false;
  try {
    ok = !!c.run(parser);
  } catch (e) {
    failures.push({ id: c.id, desc: c.desc, reason: `예외 발생: ${e.stack}` });
    fail++;
    continue;
  }
  if (ok) pass++;
  else { fail++; failures.push({ id: c.id, desc: c.desc, reason: '조건 불충족' }); }
}

console.log(`[test_cases_t.js] ${pass}/${cases.length} 통과`);
if (failures.length) {
  console.log('--- 실패 목록 ---');
  for (const f of failures) console.log(`\n[${f.id}] ${f.desc}\n  이유: ${f.reason}`);
  process.exitCode = 1;
}
