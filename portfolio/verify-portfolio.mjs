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
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPLICABILITY, RATIONALE_REQUIRED_FOR, STAGES, STATES,
  currentGate, projection, technicalCloseEligible,
} from "./lifecycle.mjs";
import { buildIndex, loadRecords, loadRoadmap, renderReadme } from "./render-index.mjs";
import {
  BLOCKER_FIELDS, BLOCKER_STATES, CLOSE_FIELDS, COMMIT_EVIDENCE_FIELDS,
  EVIDENCE_KINDS, EXTERNAL_EVIDENCE_FIELDS, INDEX_SCHEMA, MEASURED_FIELDS,
  OWNER_FIELDS, PATH_EVIDENCE_FIELDS, PRODUCT_FIELDS, PRODUCT_SCHEMA,
  REPOSITORY_SNAPSHOT_EVIDENCE_FIELDS, ROADMAP_FIELDS,
  ROADMAP_POSITION_FIELDS, ROADMAP_SCHEMA, SELECTIONS,
  SELECTION_SNAPSHOT_FIELDS, SELECTION_SNAPSHOT_SCHEMA, STAGE_FIELDS,
  WORK_ITEM_FIELDS, WORK_ITEM_STATES, duplicateKeys, isNonEmptyString,
  isNonNegativeInteger, isPlainObject, missingFields, unknownFields,
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
  if (!isPlainObject(parsed)) {
    fail(file, "top level is not an object");
    return null;
  }
  for (const key of unknownFields(parsed, allowedTop)) fail(file, `unknown field ${key}`);
  for (const key of missingFields(parsed, allowedTop)) fail(file, `missing field ${key}`);
  return parsed;
}

const fullSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const fullDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const validDate = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function checkRepoRelative(where, value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value) || value.includes("\\")
      || value.split("/").includes("..") || value.includes("\0")) {
    fail(where, `path ${JSON.stringify(value)} is not confined repository-relative POSIX form`);
    return null;
  }
  const resolved = path.resolve(repo, value);
  const prefix = `${path.resolve(repo)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    fail(where, `path ${value} escapes repository`);
    return null;
  }
  return value;
}

function checkEvidence(where, refs) {
  if (!Array.isArray(refs)) { fail(where, "evidence_refs is not an array"); return; }
  for (const ref of refs) {
    if (!isPlainObject(ref)) { fail(where, "evidence is not an object"); continue; }
    if (!EVIDENCE_KINDS.includes(ref.kind)) { fail(where, `evidence kind ${ref.kind}`); continue; }
    const fields = ref.kind === "commit" ? COMMIT_EVIDENCE_FIELDS
      : ref.kind === "path" ? PATH_EVIDENCE_FIELDS
        : ref.kind === "repository_snapshot" ? REPOSITORY_SNAPSHOT_EVIDENCE_FIELDS
          : EXTERNAL_EVIDENCE_FIELDS;
    for (const key of unknownFields(ref, fields)) fail(where, `evidence has unknown field ${key}`);
    for (const key of missingFields(ref, fields)) fail(where, `evidence is missing ${key}`);
    if (ref.kind === "commit") {
      if (!fullSha(ref.ref)) {
        fail(where, `evidence commit ${ref.ref} is not a full 40-character hash`);
      } else if (!commitExists(ref.ref)) {
        fail(where, `evidence commit ${ref.ref.slice(0, 12)} is not in this repository`);
      } else if (!reachable(ref.ref)) {
        fail(where, `evidence commit ${ref.ref.slice(0, 12)} is not reachable from ${CANONICAL_REF}`);
      }
    } else if (ref.kind === "path") {
      const confined = checkRepoRelative(where, ref.ref);
      if (!fullSha(ref.at_commit)) {
        fail(where, `path evidence at_commit ${ref.at_commit} is not a full hash`);
      } else if (!commitExists(ref.at_commit) || !reachable(ref.at_commit)) {
        fail(where, `path evidence commit ${String(ref.at_commit).slice(0, 12)} is not reachable`);
      } else if (confined !== null
          && !gitOk(["cat-file", "-e", `${ref.at_commit}:${confined}`])) {
        fail(where, `evidence path ${confined} does not exist at ${ref.at_commit.slice(0, 12)}`);
      }
    } else if (ref.kind === "external_digest") {
      if (!isNonEmptyString(ref.ref)) fail(where, "external evidence ref is empty");
      if (!isNonNegativeInteger(ref.bytes) || ref.bytes === 0) {
        fail(where, `external evidence bytes ${ref.bytes} is not positive integer`);
      }
      if (!fullDigest(ref.sha256)) fail(where, `external evidence sha256 ${ref.sha256}`);
    } else if (ref.kind === "repository_snapshot") {
      const confined = checkRepoRelative(where, ref.ref);
      if (!isNonNegativeInteger(ref.bytes) || ref.bytes === 0) {
        fail(where, `snapshot bytes ${ref.bytes} is not positive integer`);
      }
      if (!fullDigest(ref.sha256)) fail(where, `snapshot sha256 ${ref.sha256}`);
      if (confined !== null) {
        const full = path.join(repo, confined);
        if (!existsSync(full)) {
          fail(where, `snapshot ${confined} does not exist`);
        } else {
          const bytes = readFileSync(full);
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (bytes.byteLength !== ref.bytes) {
            fail(where, `snapshot ${confined} is ${bytes.byteLength} bytes, expected ${ref.bytes}`);
          }
          if (digest !== ref.sha256) {
            fail(where, `snapshot ${confined} sha256 ${digest}, expected ${ref.sha256}`);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------- roadmap
const roadmap = checkStrictJson("roadmap.json", ROADMAP_FIELDS);
const roadmapSlugs = new Map();
if (roadmap !== null) {
  if (roadmap.schema !== ROADMAP_SCHEMA) fail("roadmap.json", `schema must be ${ROADMAP_SCHEMA}`);
  if (!isNonEmptyString(roadmap.note)) fail("roadmap.json", "note is not a nonempty string");
  checkEvidence("roadmap selection_source", [roadmap.selection_source]);
  if (!Array.isArray(roadmap.positions)) {
    fail("roadmap.json", "positions is not an array");
  } else if (roadmap.positions.length !== 20) {
    fail("roadmap.json", `holds ${roadmap.positions.length} positions, not 20`);
  }
  const seen = new Set();
  (Array.isArray(roadmap.positions) ? roadmap.positions : []).forEach((entry, order) => {
    const fallback = String(order + 1).padStart(2, "0");
    if (!isPlainObject(entry)) { fail(`roadmap position ${fallback}`, "is not an object"); return; }
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
    if (entry.selection === "recovered" && !isNonEmptyString(entry.slug)) {
      fail(where, "is recovered but names no slug");
    }
    if (entry.slug !== null && (typeof entry.slug !== "string"
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug))) {
      fail(where, `slug ${JSON.stringify(entry.slug)} is not canonical kebab-case`);
    }
    if (entry.slug !== null) {
      if (roadmapSlugs.has(entry.slug)) fail(where, `slug ${entry.slug} is used twice`);
      roadmapSlugs.set(entry.slug, entry.position);
    }
  });

  if (roadmap.selection_source?.kind === "repository_snapshot"
      && isNonEmptyString(roadmap.selection_source.ref)) {
    const confined = checkRepoRelative("roadmap selection_source", roadmap.selection_source.ref);
    if (confined !== null && existsSync(path.join(repo, confined))) {
      const relative = path.relative(here, path.join(repo, confined)).replace(/\\/g, "/");
      const snapshot = checkStrictJson(relative, SELECTION_SNAPSHOT_FIELDS);
      if (snapshot !== null) {
        if (snapshot.schema !== SELECTION_SNAPSHOT_SCHEMA) {
          fail("portfolio selection snapshot", `schema must be ${SELECTION_SNAPSHOT_SCHEMA}`);
        }
        if (!isNonEmptyString(snapshot.note)) {
          fail("portfolio selection snapshot", "note is not a nonempty string");
        }
        checkEvidence("portfolio selection snapshot source", [snapshot.source]);
        if (!Array.isArray(snapshot.positions)) {
          fail("portfolio selection snapshot", "positions is not an array");
        } else if (JSON.stringify(snapshot.positions) !== JSON.stringify(roadmap.positions)) {
          fail("portfolio selection snapshot", "positions do not exactly match roadmap.json");
        }
      }
    }
  }
}

// ---------------------------------------------------------------- products
let records;
try { records = loadRecords(); }
catch (error) {
  fail("portfolio/products", error.message);
  records = new Map();
}
for (const [position, { record, file }] of records) {
  const parsed = checkStrictJson(path.relative(here, path.join(repo, file)).replace(/\\/g, "/"),
    PRODUCT_FIELDS);
  if (parsed === null) continue;
  const where = `product ${position}`;

  if (record.schema !== PRODUCT_SCHEMA) fail(where, `schema must be ${PRODUCT_SCHEMA}`);
  if (!/^[0-9]{2}$/.test(record.position ?? "")) {
    fail(where, `position ${record.position} is not padded NN`);
  }
  if (!Number.isInteger(record.id) || record.id < 1 || record.id > 20) {
    fail(where, `id ${JSON.stringify(record.id)} is not integer 1..20`);
  }
  for (const key of ["slug", "title_zh", "title_en", "summary_zh", "summary_en", "note"]) {
    if (!isNonEmptyString(record[key])) fail(where, `${key} is not a nonempty string`);
  }
  for (const key of ["work_items", "stages", "blockers", "demonstrates"]) {
    if (!Array.isArray(record[key])) fail(where, `${key} is not an array`);
  }
  if (record.intro_page !== null && !isNonEmptyString(record.intro_page)) {
    fail(where, "intro_page is neither null nor nonempty string");
  }

  // Identity must agree in three places: the filename, the padded position and
  // the numeric id. Two of the three agreeing is how a record ends up describing
  // a different product from the one it is filed under.
  const expectedFile = `portfolio/products/${record.position}-${record.slug}.json`;
  if (file !== expectedFile) fail(where, `is filed as ${file}, not ${expectedFile}`);
  if (Number.parseInt(record.position, 10) !== record.id) {
    fail(where, `position ${record.position} and id ${record.id} disagree`);
  }
  if (roadmap !== null && roadmapSlugs.get(record.slug) !== record.position) {
    fail(where, `slug ${record.slug} is not the roadmap's slug for position ${record.position}`);
  }

  for (const key of ["denominator_ref", "app_path"]) {
    const confined = checkRepoRelative(where, record[key]);
    if (confined === null || !existsSync(path.join(repo, confined))) {
      fail(where, `${key} ${JSON.stringify(record[key])} does not exist`);
    }
  }
  if (!isPlainObject(record.owners)) fail(where, "owners is not an object");
  for (const key of unknownFields(record.owners, OWNER_FIELDS)) fail(where, `owners has unknown field ${key}`);
  for (const key of missingFields(record.owners, OWNER_FIELDS)) fail(where, `owners is missing ${key}`);
  for (const key of OWNER_FIELDS) {
    if (!isNonEmptyString(record.owners?.[key])) fail(where, `owner ${key} is not a nonempty string`);
  }

  const workKeys = new Set();
  for (const item of Array.isArray(record.work_items) ? record.work_items : []) {
    if (!isPlainObject(item)) { fail(where, "work item is not an object"); continue; }
    const scope = `${where} work item ${item.key}`;
    for (const key of unknownFields(item, WORK_ITEM_FIELDS)) fail(scope, `unknown field ${key}`);
    for (const key of missingFields(item, WORK_ITEM_FIELDS)) fail(scope, `missing field ${key}`);
    if (workKeys.has(item.key)) fail(scope, "appears twice");
    workKeys.add(item.key);
    if (!isNonEmptyString(item.key) || !isNonEmptyString(item.title)) {
      fail(scope, "key/title is not a nonempty string");
    }
    if (!WORK_ITEM_STATES.includes(item.state)) fail(scope, `state ${item.state}`);
    if (item.state === "passed" && (item.evidence_refs ?? []).length === 0) {
      fail(scope, "is passed with no evidence");
    }
    checkEvidence(scope, item.evidence_refs);
  }

  const blockerKeys = new Set();
  for (const blocker of Array.isArray(record.blockers) ? record.blockers : []) {
    if (!isPlainObject(blocker)) { fail(where, "blocker is not an object"); continue; }
    const scope = `${where} blocker ${blocker.key}`;
    for (const key of unknownFields(blocker, BLOCKER_FIELDS)) fail(scope, `unknown field ${key}`);
    for (const key of missingFields(blocker, BLOCKER_FIELDS)) fail(scope, `missing field ${key}`);
    if (blockerKeys.has(blocker.key)) fail(scope, "appears twice");
    blockerKeys.add(blocker.key);
    if (!isNonEmptyString(blocker.key) || !isNonEmptyString(blocker.title)) {
      fail(scope, "key/title is not a nonempty string");
    }
    if (!BLOCKER_STATES.includes(blocker.state)) fail(scope, `state ${blocker.state}`);
    if (blocker.rationale !== null && !isNonEmptyString(blocker.rationale)) {
      fail(scope, "rationale is neither null nor nonempty string");
    }
    if (blocker.state === "moved_outside_technical_slice"
        && (blocker.rationale === null || blocker.rationale === undefined)) {
      fail(scope, "was moved outside the technical slice without a rationale");
    }
    checkEvidence(scope, blocker.evidence_refs);
    if (["resolved", "moved_outside_technical_slice"].includes(blocker.state)
        && (!Array.isArray(blocker.evidence_refs) || blocker.evidence_refs.length === 0)) {
      fail(scope, `${blocker.state} without resolution/authority evidence`);
    }
  }

  const seenStages = new Set();
  for (const stage of Array.isArray(record.stages) ? record.stages : []) {
    if (!isPlainObject(stage)) { fail(where, "stage is not an object"); continue; }
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
    if (stage.rationale !== null && !isNonEmptyString(stage.rationale)) {
      fail(scope, "rationale is neither null nor nonempty string");
    }
    if (owes && (!Array.isArray(stage.evidence_refs) || stage.evidence_refs.length === 0)) {
      fail(scope, `is ${stage.applicability}/${stage.state} without review evidence`);
    }
    if (stage.state === "passed" && (stage.evidence_refs ?? []).length === 0) {
      fail(scope, "is passed with no evidence");
    }
    checkEvidence(scope, stage.evidence_refs);
  }
  for (const name of STAGES) if (!seenStages.has(name)) fail(where, `stage ${name} is missing`);
  if (Array.isArray(record.stages)) {
    const order = record.stages.map((stage) => stage?.stage);
    if (order.length !== STAGES.length || order.some((name, index) => name !== STAGES[index])) {
      fail(where, "stages are not in the agreed canonical order");
    }
  }
  for (const item of Array.isArray(record.demonstrates) ? record.demonstrates : []) {
    if (!isNonEmptyString(item)) fail(where, "demonstrates contains non-string/empty item");
  }

  const closedStage = (Array.isArray(record.stages) ? record.stages : [])
    .find((s) => s.stage === "technical_close");
  const closed = closedStage !== undefined && closedStage.state === "passed";
  if (!closed) {
    if (record.close !== null) fail(where, "is not technically closed but carries a close reference");
    continue;
  }
  if (!Array.isArray(record.blockers) || !technicalCloseEligible(record)) {
    fail(where, "technical_close is passed while the derivation says it is not eligible");
  }
  if (!Array.isArray(closedStage.evidence_refs)
      || !closedStage.evidence_refs.some((ref) => ["external_digest", "repository_snapshot"].includes(ref?.kind))) {
    fail(where, "technical_close has no review/decision evidence distinct from the code commit");
  }
  if (record.close === null || record.close === undefined) {
    fail(where, "technical_close is passed with no close reference");
  } else {
    if (!isPlainObject(record.close)) {
      fail(where, "close is not an object");
    }
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
      for (const key of ["denominator_ref", "app_path"]) {
        const confined = checkRepoRelative(where, record[key]);
        if (confined !== null && !gitOk(["cat-file", "-e", `${commit}:${confined}`])) {
          fail(where, `${key} ${confined} did not exist at close commit ${commit.slice(0, 12)}`);
        }
      }
    }
    if (!fullSha(tree)) fail(where, `close.tree ${tree} is not a full 40-character hash`);
    if (!validDate(record.close.date)) fail(where, `close.date ${record.close.date} is not YYYY-MM-DD`);
  }
  const m = record.measured;
  if (!isPlainObject(m)) {
    fail(where, "is technically closed with no measured numbers");
  } else {
    for (const key of unknownFields(m, MEASURED_FIELDS)) fail(where, `measured has unknown field ${key}`);
    for (const key of missingFields(m, MEASURED_FIELDS)) fail(where, `measured is missing ${key}`);
    for (const key of MEASURED_FIELDS.filter((name) => name !== "outsourced_units_byte_identical")) {
      if (!isNonNegativeInteger(m[key])) fail(where, `measured.${key} is not a nonnegative integer`);
    }
    if (typeof m.outsourced_units_byte_identical !== "boolean") {
      fail(where, "measured.outsourced_units_byte_identical is not boolean");
    }
    if (!(m.tests > 0)) fail(where, "is closed with no tests");
    if (m.test_failures !== 0) fail(where, `is closed with ${m.test_failures} failing tests`);
    if (m.drill_mutations_surviving !== 0) {
      fail(where, `is closed with ${m.drill_mutations_surviving} mutations the drills did not catch`);
    }
    if (m.acceptance_ids_open !== 0) {
      fail(where, `is closed with ${m.acceptance_ids_open} acceptance IDs still open`);
    }
  }
  if (Array.isArray(record.blockers) && record.blockers.some((b) => b.state === "open")) {
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
