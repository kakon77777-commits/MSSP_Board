// Prove portfolio/verify-portfolio.mjs can fail.
//
//   node portfolio/drill-portfolio.mjs
//
// The verifier's checks are claims like any other, and a check nobody has seen
// fail is a check nobody has seen. Every mutation below must turn it red; a
// mutation that leaves it green is either a hole or an edit that changes no
// answer, and both print green, so any green here is read by hand.
//
// DID_NOT_APPLY is distinguished from red on purpose. A mutation whose anchor
// has moved silently tests nothing while looking like a pass, which is the exact
// failure this whole file exists to rule out.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const RECORD = path.join(here, "products", "01-text-editor-basic.json");
const ROADMAP = path.join(here, "roadmap.json");
const INDEX = path.join(here, "index.json");
const README = path.join(here, "README.md");
const say = (line) => process.stdout.write(line + "\n");

function verify() {
  const run = spawnSync(process.execPath, [path.join(here, "verify-portfolio.mjs")],
    { cwd: repo, encoding: "utf8", timeout: 30_000 });
  const output = `${run.stderr ?? ""}\n${run.stdout ?? ""}`.trim();
  const state = run.status === 0 ? "green"
    : run.status === 1 && /^\s*FAIL\s/m.test(output) ? "red" : "error";
  return {
    state,
    first: run.error?.message ?? output.split(/\r?\n/)[0] ?? "",
  };
}

// Each mutation is a plain text substitution so the anchor is checkable: if the
// `from` string is absent the record has moved and the case is reported as
// DID_NOT_APPLY rather than counted.
const MUTATIONS = [
  { name: "a stage is deferred without a rationale", file: RECORD,
    from: '"stage": "system_acceptance", "applicability": "required", "state": "passed"',
    to: '"stage": "system_acceptance", "applicability": "required", "state": "deferred"' },
  { name: "a required stage reopens under a passed close", file: RECORD,
    from: '"stage": "integration", "applicability": "required", "state": "passed"',
    to: '"stage": "integration", "applicability": "required", "state": "active"' },
  { name: "the close commit is not reachable from main", file: RECORD,
    from: '"commit": "7366c4ec0e4404bbb571964adcdc139254df6c50",\n    "tree"',
    to: '"commit": "0000000000000000000000000000000000000000",\n    "tree"' },
  { name: "the close tree is not that commit's tree", file: RECORD,
    from: '"tree": "c636d10854dd6aeade5ad3131f527421bc8036ae"',
    to: '"tree": "0b9f9b9c500611721fb8a13a38dee43efc1431e1"' },
  { name: "a closed product carries an open blocker", file: RECORD,
    from: '"blockers": [],',
    to: '"blockers": [{ "key": "x", "title": "t", "state": "open", "rationale": null, "evidence_refs": [] }],' },
  { name: "a closed product has an acceptance ID still open", file: RECORD,
    from: '"acceptance_ids_open": 0', to: '"acceptance_ids_open": 1' },
  { name: "an evidence path does not exist", file: RECORD,
    from: '{ "kind": "path", "ref": "apps/text-editor-basic/src/main/boundary-snapshot.ts",\n          "at_commit": "7366c4ec0e4404bbb571964adcdc139254df6c50" }',
    to: '{ "kind": "path", "ref": "apps/text-editor-basic/src/main/does-not-exist.ts",\n          "at_commit": "7366c4ec0e4404bbb571964adcdc139254df6c50" }' },
  { name: "an evidence commit is abbreviated", file: RECORD,
    from: '{ "kind": "commit", "ref": "2997b78e8570b4300638c122632efa95a4acd049" }',
    to: '{ "kind": "commit", "ref": "2997b78" }' },
  { name: "the record has an unknown field", file: RECORD,
    from: '  "intro_page": null\n}', to: '  "intro_page": null,\n  "statuz": "closed"\n}' },
  { name: "the record has a duplicate JSON key", file: RECORD,
    from: '  "slug": "text-editor-basic",',
    to: '  "slug": "text-editor-basic",\n  "slug": "something-else",' },
  { name: "the record and its filename disagree", file: RECORD,
    from: '"position": "01",\n  "id": 1,', to: '"position": "02",\n  "id": 2,' },
  { name: "a pending roadmap position is given a slug", file: ROADMAP,
    from: '{ "position": "16", "slug": null, "selection": "unnamed_pending_bounded_review" }',
    to: '{ "position": "16", "slug": "invented", "selection": "unnamed_pending_bounded_review" }' },
  { name: "two roadmap positions claim the same slug", file: ROADMAP,
    from: '{ "position": "03", "slug": "markdown-editor",    "selection": "recovered" }',
    to: '{ "position": "03", "slug": "file-manager-basic",    "selection": "recovered" }' },
  { name: "the generated index is hand-edited", file: INDEX,
    from: '"technical_close_eligible": true', to: '"technical_close_eligible": false' },
  { name: "the generated README is hand-edited", file: README,
    from: "技術結案", to: "進行中" },
];

say("\n=== drill-portfolio — can the portfolio verifier fail?\n");
const control = verify();
say(`  control (nothing mutated) ... ${control.state}`);
if (control.state !== "green") {
  say(`  the control is not green, so nothing below would mean anything: ${control.first}`);
  process.exit(1);
}

let green = 0;
let errors = 0;
let didNotApply = 0;
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, "utf8");
  if (!original.includes(mutation.from)) {
    say(`  DID NOT APPLY  ${mutation.name}`);
    didNotApply += 1;
    continue;
  }
  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to), "utf8");
  let outcome;
  try {
    outcome = verify();
  } finally {
    // Restore before anything else can read the tree. A drill that skipped this
    // once left a planted defect behind, and the next run reported on a subject
    // nobody meant to test.
    writeFileSync(mutation.file, original, "utf8");
  }
  if (outcome.state === "green") {
    say(`  GREEN (hole or no-op)  ${mutation.name}`);
    green += 1;
  } else if (outcome.state === "error") {
    say(`  ERROR (verifier did not reject cleanly)  ${mutation.name}: ${outcome.first}`);
    errors += 1;
  } else {
    say(`  red   ${mutation.name.padEnd(48)} ${outcome.first.replace(/^\s*FAIL\s*/, "").slice(0, 60)}`);
  }
}

const restored = verify();
say(`\n  restored control ... ${restored.state}`);
say(`  ${MUTATIONS.length} mutations   ${green} green   ${errors} errors   ${didNotApply} did not apply`);
process.exit(green === 0 && errors === 0 && didNotApply === 0
  && restored.state === "green" ? 0 : 1);
