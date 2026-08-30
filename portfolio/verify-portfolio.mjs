// Check the portfolio against the repository and against its own derivations.
//
//   node portfolio/verify-portfolio.mjs
//
// A portfolio is a set of claims about work that lives elsewhere, so it drifts
// the moment either side moves and nothing says so. This repo's first rule
// applies: a claim either runs or does not count.
//
// What it refuses:
//   - a stage name, applicability or state outside the agreed vocabulary
//   - `deferred` or `not_applicable` without a rationale
//   - a close reference whose commit is not in this repository
//   - a technical_close marked passed while the derivation says it is not
//     eligible, which is how a product closes over an unfinished gate
//   - a denominator or app path that is not there
//   - measured numbers that contradict a closed product
//   - a generated index or README that has fallen behind the records
//
// ATTACK: each of these must make this script exit 1.
//   - set stage `system_acceptance` to `deferred` without a rationale
//   - set stage `integration` to `active` while technical_close stays passed
//   - point `close.commit` at a commit that is not in this repository
//   - add an open blocker to a technically closed product
//   - set measured.acceptance_ids_open to 1
//   - hand-edit portfolio/index.json or portfolio/README.md
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPLICABILITY, RATIONALE_REQUIRED_FOR, STAGES, STATES,
  currentGate, projection, technicalCloseEligible,
} from "./lifecycle.mjs";
import { buildIndex, loadRecords, renderReadme } from "./render-index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

const failures = [];
const fail = (id, message) => failures.push(`product ${id}: ${message}`);

function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const records = loadRecords();
if (records.size === 0) failures.push("no product records exist under portfolio/products/");

for (const [id, { record }] of records) {
  if (id < 1 || id > 20) fail(id, "is outside the twenty fixed positions");

  for (const key of ["denominator_ref", "app_path"]) {
    const value = record[key];
    if (typeof value !== "string" || !existsSync(path.join(repo, value))) {
      fail(id, `${key} ${JSON.stringify(value)} does not exist`);
    }
  }

  const seen = new Set();
  for (const stage of record.stages) {
    if (!STAGES.includes(stage.stage)) { fail(id, `unknown stage ${stage.stage}`); continue; }
    if (seen.has(stage.stage)) fail(id, `stage ${stage.stage} appears twice`);
    seen.add(stage.stage);
    if (!APPLICABILITY.includes(stage.applicability)) {
      fail(id, `stage ${stage.stage} has applicability ${stage.applicability}`);
    }
    if (!STATES.includes(stage.state)) {
      fail(id, `stage ${stage.stage} has state ${stage.state}`);
    }
    // not_applicable and deferred both owe a reason. Without one they are a
    // silent skip wearing a vocabulary word.
    const owesRationale = stage.applicability === "not_applicable"
      || RATIONALE_REQUIRED_FOR.includes(stage.state);
    if (owesRationale && (stage.rationale === null || stage.rationale === undefined)) {
      fail(id, `stage ${stage.stage} is ${stage.applicability}/${stage.state} without a rationale`);
    }
    if (stage.state === "passed" && (stage.evidence_refs ?? []).length === 0) {
      fail(id, `stage ${stage.stage} is passed with no evidence`);
    }
  }
  for (const name of STAGES) {
    if (!seen.has(name)) fail(id, `stage ${name} is missing from the record`);
  }

  const closedStage = record.stages.find((s) => s.stage === "technical_close");
  const closed = closedStage !== undefined && closedStage.state === "passed";
  if (closed) {
    // The derivation is the authority. A record that says it closed while the
    // stages say a required gate is unfinished is the exact drift this file
    // exists to catch.
    if (!technicalCloseEligible(record)) {
      fail(id, "technical_close is passed while the derivation says it is not eligible");
    }
    if (record.close === null || record.close === undefined) {
      fail(id, "technical_close is passed with no close reference");
    } else if (!commitExists(record.close.commit)) {
      fail(id, `close.commit ${String(record.close.commit).slice(0, 12)} is not in this repository`);
    }
    const m = record.measured;
    if (m === null || m === undefined) {
      fail(id, "is technically closed with no measured numbers");
    } else {
      if (!(m.tests > 0)) fail(id, "is closed with no tests");
      if (m.test_failures !== 0) fail(id, `is closed with ${m.test_failures} failing tests`);
      if (m.drill_mutations_surviving !== 0) {
        fail(id, `is closed with ${m.drill_mutations_surviving} mutations the drills did not catch`);
      }
      if (m.acceptance_ids_open !== 0) {
        fail(id, `is closed with ${m.acceptance_ids_open} acceptance IDs still open`);
      }
    }
    if (record.blockers.some((b) => b.state === "open")) {
      fail(id, "is technically closed with an open blocker");
    }
  }
}

const index = buildIndex(records);
const wantedIndex = JSON.stringify(index, null, 2) + "\n";
const wantedReadme = renderReadme(index, records);
for (const [file, wanted] of [["index.json", wantedIndex], ["README.md", wantedReadme]]) {
  const full = path.join(here, file);
  const found = existsSync(full) ? readFileSync(full, "utf8") : null;
  if (found !== wanted) {
    failures.push(found === null
      ? `portfolio/${file} does not exist; run: node portfolio/render-index.mjs`
      : `portfolio/${file} is stale or hand-edited; run: node portfolio/render-index.mjs`);
  }
}

if (failures.length === 0) {
  const filled = [...records.values()];
  const closed = filled.filter(({ record }) => projection(record) === "technical_closed").length;
  process.stdout.write(`  ok   20 positions, ${records.size} with records, ${closed} technically closed\n`);
  process.stdout.write("  ok   every stage uses the agreed vocabulary and owes its rationale\n");
  process.stdout.write("  ok   every close names a reachable commit and carries measured numbers\n");
  process.stdout.write("  ok   the generated index and README match the records\n");
  for (const [id, { record }] of records) {
    const gate = currentGate(record);
    process.stdout.write(`       ${id}. ${record.slug}: ${projection(record)}`
      + `, gate ${gate === null ? "(none)" : gate}\n`);
  }
  process.exit(0);
}
for (const line of failures) process.stderr.write(`  FAIL ${line}\n`);
process.exit(1);
