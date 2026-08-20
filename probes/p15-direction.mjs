// 改良點 15 — a unit may declare itself INCOMPLETE and may not declare itself
// COMPLETE. A declaration that can only make the report worse for the declarer
// is taken on trust; one that makes it better is refused.
//
// Full entry: https://thisoneisneok.com/html/mssp/017-finished-is-not-complete.html
//
//   node probes/p15-direction.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const DECLARED_INCOMPLETE = "no - declared";
const NOT_KNOWN_OTHERWISE = "not known to be otherwise";
// There is deliberately no third value. Nothing here can put a source in a
// verified-complete state, so the report never offers one.

const SOURCES = {
  "full-page": { records: 3, declares: null },
  // The control: two records, finishes, and genuinely has nothing more.
  "short-page": { records: 2, declares: null },
  "truncated-page": { records: 2, declares: "more-after-cursor" },
  // Truncated and silent. The gap, kept as a running unit rather than a
  // sentence in a README.
  "quiet-truncation": { records: 2, declares: null, TRUTH_NOBODY_CAN_SEE: "there is a cursor after these two" },
};

const load = (extra = {}) => {
  const problems = [];
  for (const [name, s] of Object.entries({ ...SOURCES, ...extra })) {
    for (const vouch of ["COMPLETE", "IS_COMPLETE", "RETURNS_EVERYTHING"]) {
      if (s[vouch] === true) problems.push(`${name}: declares ${vouch}`);
    }
  }
  return problems;
};

const rows = () => Object.entries(SOURCES).map(([name, s]) => ({
  source: name,
  records: s.records,
  completeness: s.declares ? DECLARED_INCOMPLETE : NOT_KNOWN_OTHERWISE,
}));

const floorOf = (rs) => rs.filter((r) => r.completeness === DECLARED_INCOMPLETE)
  .reduce((n, r) => n + r.records, 0);

export function run() {
  const { say, check, done } = harness("p15 — the direction of a declaration");

  const rs = rows();
  const total = rs.reduce((n, r) => n + r.records, 0);
  say("\n  1. every source finished, none failed, and they are not all complete");
  for (const r of rs) say(`     ${r.source.padEnd(18)} ${String(r.records).padEnd(3)} ${r.completeness}`);
  check("the completeness column takes exactly two values",
    new Set(rs.map((r) => r.completeness)).size === 2);
  check("and neither of them is `complete`",
    ![DECLARED_INCOMPLETE, NOT_KNOWN_OTHERWISE].some((v) => v.includes("complete")),
    "a report offering `complete` claims something it did not measure");

  say("\n  2. the self-serving direction is refused");
  check("DRILL: a source declaring COMPLETE is refused",
    load({ "drill-vouch": { records: 1, declares: null, COMPLETE: true } }).length === 1);
  check("and the honest units raise nothing", load().length === 0);

  say("\n  3. the number is a FLOOR, and must say so");
  const sentence = `at least ${floorOf(rs)} of ${total} records come from a source that declared itself incomplete`;
  say(`     ${sentence}`);
  check("the floor counts only what was declared", floorOf(rs) === 2, `${floorOf(rs)} of ${total}`);
  check('the sentence says "at least"', /at least/.test(sentence));
  check("and the true number is higher — quiet-truncation is truncated too",
    Boolean(SOURCES["quiet-truncation"].TRUTH_NOBODY_CAN_SEE));

  say("\n  4. the gap, asserted so it stays measured");
  const quiet = rs.find((r) => r.source === "quiet-truncation");
  const control = rs.find((r) => r.source === "short-page");
  check("quiet-truncation matches the COMPLETE control on every field read here",
    quiet.records === control.records && quiet.completeness === control.completeness,
    "if this goes red the limit changed and the docs are wrong");

  return done();
}

// ATTACK:
//   a. THE ONE I WANT MOST: "self-penalising" is my judgement about incentives,
//      not a property of the code. p16 breaks it under one policy. Break it
//      under a SECOND, structurally different one — ideally multi-consumer.
//   b. make quiet-truncation declare  ->  section 4 goes red, correctly.
//   c. change "at least" to "exactly" in the sentence  ->  section 3 goes red.
//   d. argue that 改良點 15 is empty where the unit has no such knowledge at
//      all (a full table scan does not know). If most real sources are in that
//      position, this is a field nobody fills. I could not make that objection
//      stick against my own example.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
