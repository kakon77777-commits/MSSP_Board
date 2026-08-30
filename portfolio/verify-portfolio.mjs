// Check the portfolio against the repository, the schema, and its own derivations.
//
//   node portfolio/verify-portfolio.mjs
//
// A portfolio is a set of claims about work that lives elsewhere, so it drifts
// the moment either side moves and nothing says so. This repo's first rule
// applies: a claim either runs or does not count.
//
// The executable proof that these checks can fail is portfolio/drill-portfolio.mjs.
// It is a separate file on purpose: a comment claiming an attack was tried is
// exactly the prose this repo does not accept.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPLICABILITY, RATIONALE_REQUIRED_FOR, STAGES, STATES,
  currentGate, projection, technicalCloseEligible,
} from "./lifecycle.mjs";
import { buildIndex, loadRecords, loadRoadmap, renderReadme } from "./render-index.mjs";
import {
  BLOCKER_FIELDS, BLOCKER_STATES, CLOSE_FIELDS, EVIDENCE_FIELDS, EVIDENCE_KINDS,
  MEASURED_FIELDS, OWNER_FIELDS, PRODUCT_FIELDS, ROADMAP_FIELDS,
  ROADMAP_POSITION_FIELDS, SELECTIONS, STAGE_FIELDS, WORK_ITEM_FIELDS, WORK_ITEM_STATES,
  duplicateKeys, missingFields, unknownFields,
} from "./schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

// A close commit must be reachable from the branch this repository publishes,
// not merely present as an object. A dangling or fetched-but-unmerged commit
// exists and proves nothing about what was actually shipped.
const CANONICAL_REF = "main";

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function gitOk(args) {
  try { execFileSync("git", args, { cwd: repo, stdio: "pipe" }); return true; }
  catch { return false; }
}
const commitExists = (sha) => gitOk(["cat-file", "-e", `${sha}^{commit}`]);
const reachable = (sha) => gitOk(["merge-base", "--is-ancestor", sha, CANONICAL_REF]);

function checkStrictJson(file, allowedTop) {
  const full = path.join(here, file);
  if (!existsSync(full)) { fail(file, "does not exist"); return null; }
  const text = readFileSync(full, "utf8");
  for (const key of duplicateKeys(text)) {
    fail(file, `duplicate JSON key ${JSON.stringify(key)}; JSON.parse keeps only the last`);
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) { fail(file, `is not valid JSON: ${error.message}`); return null; }
  for (const key of unknownFields(parsed, allowedTop)) fail(file, `unknown field ${key}`);
  for (const key of missingFields(parsed, allowedTop)) fail(file, `missing field ${key}`);
  return parsed;
}

function checkEvidence(where, refs) {
  if (!Array.isArray(refs)) { fail(where, "evidence_refs is not an array"); return; }
  for (const ref of refs) {
    for (const key of unknownFields(ref, EVIDENCE_FIELDS)) fail(where, `evidence has unknown field ${key}`);
    for (const key of missingFields(ref, EVIDENCE_FIELDS)) fail(where, `evidence is missing ${key}`);
    if (!EVIDENCE_KINDS.includes(ref.kind)) { fail(where, `evidence kind ${ref.kind}`); continue; }
    if (ref.kind === "path" && !existsSync(path.join(repo, ref.ref))) {
      fail(where, `evidence path ${ref.ref} does not exist`);
    }
    if (ref.kind === "commit") {
      if (!/^[0-9a-f]{40}$/.test(ref.ref)) {
        fail(where, `evidence commit ${ref.ref} is not a full 40-character hash`);
      } else if (!commitExists(ref.ref)) {
        fail(where, `evidence commit ${ref.ref.slice(0, 12)} is not in this repository`);
      } else if (!reachable(ref.ref)) {
        fail(where, `evidence commit ${ref.ref.slice(0, 12)} is not reachable from ${CANONICAL_REF}`);
      }
    }
  }
}

// ---------------------------------------------------------------- roadmap
const roadmap = checkStrictJson("roadmap.json", ROADMAP_FIELDS);
const roadmapSlugs = new Map();
if (roadmap !== null) {
  if (roadmap.positions.length !== 20) {
    fail("roadmap.json", `holds ${roadmap.positions.length} positions, not 20`);
  }
  const seen = new Set();
  roadmap.positions.forEach((entry, order) => {
    const where = `roadmap position ${entry.position}`;
    for (const key of unknownFields(entry, ROADMAP_POSITION_FIELDS)) fail(where, `unknown field ${key}`);
    for (const key of missingFields(entry, ROADMAP_POSITION_FIELDS)) fail(where, `missing field ${key}`);
    const expected = String(order + 1).padStart(2, "0");
    if (entry.position !== expected) fail(where, `is out of order; expected ${expected}`);
    if (seen.has(entry.position)) fail(where, "appears twice");
    seen.add(entry.position);
    if (!SELECTIONS.includes(entry.selection)) fail(where, `unknown selection ${entry.selection}`);
    if (entry.selection === "unnamed_pending_bounded_review" && entry.slug !== null) {
      fail(where, "is pending review but carries a slug");
    }
    if (entry.selection === "recovered" && typeof entry.slug !== "string") {
      fail(where, "is recovered but names no slug");
    }
    if (entry.slug !== null) {
      if (roadmapSlugs.has(entry.slug)) fail(where, `slug ${entry.slug} is used twice`);
      roadmapSlugs.set(entry.slug, entry.position);
    }
  });
}

// ---------------------------------------------------------------- products
const records = loadRecords();
for (const [position, { record, file }] of records) {
  const parsed = checkStrictJson(path.relative(here, path.join(repo, file)).replace(/\\/g, "/"),
    PRODUCT_FIELDS);
  if (parsed === null) continue;
  const where = `product ${position}`;

  // Identity must agree in three places: the filename, the padded position and
  // the numeric id. Two of the three agreeing is how a record ends up describing
  // a different product from the one it is filed under.
  const expectedFile = `portfolio/products/${record.position}-${record.slug}.json`;
  if (file !== expectedFile) fail(where, `is filed as ${file}, not ${expectedFile}`);
  if (!/^[0-9]{2}$/.test(record.position)) fail(where, `position ${record.position} is not padded NN`);
  if (Number.parseInt(record.position, 10) !== record.id) {
    fail(where, `position ${record.position} and id ${record.id} disagree`);
  }
  if (roadmap !== null && roadmapSlugs.get(record.slug) !== record.position) {
    fail(where, `slug ${record.slug} is not the roadmap's slug for position ${record.position}`);
  }

  for (const key of ["denominator_ref", "app_path"]) {
    if (typeof record[key] !== "string" || !existsSync(path.join(repo, record[key]))) {
      fail(where, `${key} ${JSON.stringify(record[key])} does not exist`);
    }
  }
  for (const key of unknownFields(record.owners, OWNER_FIELDS)) fail(where, `owners has unknown field ${key}`);
  for (const key of missingFields(record.owners, OWNER_FIELDS)) fail(where, `owners is missing ${key}`);

  const workKeys = new Set();
  for (const item of record.work_items) {
    const scope = `${where} work item ${item.key}`;
    for (const key of unknownFields(item, WORK_ITEM_FIELDS)) fail(scope, `unknown field ${key}`);
    for (const key of missingFields(item, WORK_ITEM_FIELDS)) fail(scope, `missing field ${key}`);
    if (workKeys.has(item.key)) fail(scope, "appears twice");
    workKeys.add(item.key);
    if (!WORK_ITEM_STATES.includes(item.state)) fail(scope, `state ${item.state}`);
    if (item.state === "passed" && (item.evidence_refs ?? []).length === 0) {
      fail(scope, "is passed with no evidence");
    }
    checkEvidence(scope, item.evidence_refs);
  }

  for (const blocker of record.blockers) {
    const scope = `${where} blocker ${blocker.key}`;
    for (const key of unknownFields(blocker, BLOCKER_FIELDS)) fail(scope, `unknown field ${key}`);
    for (const key of missingFields(blocker, BLOCKER_FIELDS)) fail(scope, `missing field ${key}`);
    if (!BLOCKER_STATES.includes(blocker.state)) fail(scope, `state ${blocker.state}`);
    if (blocker.state === "moved_outside_technical_slice"
        && (blocker.rationale === null || blocker.rationale === undefined)) {
      fail(scope, "was moved outside the technical slice without a rationale");
    }
    checkEvidence(scope, blocker.evidence_refs);
  }

  const seenStages = new Set();
  for (const stage of record.stages) {
    const scope = `${where} stage ${stage.stage}`;
    for (const key of unknownFields(stage, STAGE_FIELDS)) fail(scope, `unknown field ${key}`);
    for (const key of missingFields(stage, STAGE_FIELDS)) fail(scope, `missing field ${key}`);
    if (!STAGES.includes(stage.stage)) { fail(scope, "is not a known stage"); continue; }
    if (seenStages.has(stage.stage)) fail(scope, "appears twice");
    seenStages.add(stage.stage);
    if (!APPLICABILITY.includes(stage.applicability)) fail(scope, `applicability ${stage.applicability}`);
    if (!STATES.includes(stage.state)) fail(scope, `state ${stage.state}`);
    // not_applicable and deferred both owe a reason. Without one they are a
    // silent skip wearing a vocabulary word.
    const owes = stage.applicability === "not_applicable" || RATIONALE_REQUIRED_FOR.includes(stage.state);
    if (owes && (stage.rationale === null || stage.rationale === undefined)) {
      fail(scope, `is ${stage.applicability}/${stage.state} without a rationale`);
    }
    if (stage.state === "passed" && (stage.evidence_refs ?? []).length === 0) {
      fail(scope, "is passed with no evidence");
    }
    checkEvidence(scope, stage.evidence_refs);
  }
  for (const name of STAGES) if (!seenStages.has(name)) fail(where, `stage ${name} is missing`);

  const closedStage = record.stages.find((s) => s.stage === "technical_close");
  const closed = closedStage !== undefined && closedStage.state === "passed";
  if (!closed) {
    if (record.close !== null) fail(where, "is not technically closed but carries a close reference");
    continue;
  }
  if (!technicalCloseEligible(record)) {
    fail(where, "technical_close is passed while the derivation says it is not eligible");
  }
  if (record.close === null || record.close === undefined) {
    fail(where, "technical_close is passed with no close reference");
  } else {
    for (const key of unknownFields(record.close, CLOSE_FIELDS)) fail(where, `close has unknown field ${key}`);
    for (const key of missingFields(record.close, CLOSE_FIELDS)) fail(where, `close is missing ${key}`);
    const { commit, tree } = record.close;
    if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
      fail(where, `close.commit ${commit} is not a full 40-character hash`);
    } else if (!commitExists(commit)) {
      fail(where, `close.commit ${commit.slice(0, 12)} is not in this repository`);
    } else if (!reachable(commit)) {
      fail(where, `close.commit ${commit.slice(0, 12)} is not reachable from ${CANONICAL_REF}`);
    } else {
      const actual = git(["rev-parse", `${commit}^{tree}`]);
      if (actual !== tree) {
        fail(where, `close.tree ${String(tree).slice(0, 12)} is not the tree of that commit `
          + `(${actual.slice(0, 12)})`);
      }
    }
  }
  const m = record.measured;
  if (m === null || m === undefined) {
    fail(where, "is technically closed with no measured numbers");
  } else {
    for (const key of unknownFields(m, MEASURED_FIELDS)) fail(where, `measured has unknown field ${key}`);
    for (const key of missingFields(m, MEASURED_FIELDS)) fail(where, `measured is missing ${key}`);
    if (!(m.tests > 0)) fail(where, "is closed with no tests");
    if (m.test_failures !== 0) fail(where, `is closed with ${m.test_failures} failing tests`);
    if (m.drill_mutations_surviving !== 0) {
      fail(where, `is closed with ${m.drill_mutations_surviving} mutations the drills did not catch`);
    }
    if (m.acceptance_ids_open !== 0) {
      fail(where, `is closed with ${m.acceptance_ids_open} acceptance IDs still open`);
    }
  }
  if (record.blockers.some((b) => b.state === "open")) {
    fail(where, "is technically closed with an open blocker");
  }
}

// ---------------------------------------------------------------- generated
if (roadmap !== null) {
  const index = buildIndex(loadRoadmap(), records);
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
}

if (failures.length === 0) {
  const closed = [...records.values()]
    .filter(({ record }) => projection(record) === "technical_closed").length;
  const named = roadmap.positions.filter((p) => p.slug !== null).length;
  process.stdout.write(`  ok   20 positions: ${named} named, ${records.size} with records, `
    + `${closed} technically closed\n`);
  process.stdout.write("  ok   strict schema: no unknown fields, no duplicate keys, identity agrees\n");
  process.stdout.write(`  ok   every evidence ref resolves; every close is reachable from ${CANONICAL_REF} `
    + "and its tree matches\n");
  process.stdout.write("  ok   the generated index and README match the records\n");
  for (const [position, { record }] of records) {
    const gate = currentGate(record);
    process.stdout.write(`       ${position} ${record.slug}: ${projection(record)}`
      + `, gate ${gate === null ? "(none)" : gate}\n`);
  }
  process.exit(0);
}
for (const line of failures) process.stderr.write(`  FAIL ${line}\n`);
process.exit(1);
