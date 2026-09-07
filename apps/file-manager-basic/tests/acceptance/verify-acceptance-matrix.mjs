import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..", "..");
const matrixArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const matrixPath = matrixArgument ?? path.join(here, "acceptance-matrix.json");
const behaviorOnly = process.argv.includes("--behavior-only");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
const failures = [];
const fail = (label) => failures.push(label);
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

let matrix = null;
try { matrix = JSON.parse(readFileSync(matrixPath, "utf8")); }
catch (error) { fail(`matrix readable JSON: ${error.message}`); }

const testFiles = new Set();
let expectedIds = [];
if (matrix) {
  if (!exactKeys(matrix, ["schema", "sources", "policy", "entries", "additional_gates", "native_artifacts"])) fail("exact matrix fields");
  if (matrix.schema !== "mssp.file-manager.acceptance-matrix/v1-candidate") fail("matrix schema");
  if (!exactKeys(matrix.sources, ["preregistration_path", "preregistration_bytes", "preregistration_sha256", "acceptance_catalog_sha256", "acceptance_resolver_sha256", "destination_effective_sha256", "postscan_correction_sha256", "postscan_correction_status", "postscan_effective_path", "postscan_effective_sha256"])) fail("exact source fields");
  if (!exactKeys(matrix.policy, ["entry_count", "mapping_bytes", "mapping_sha256", "default_exit_requires_no_governance_pending", "whole_test_file_failure_is_conservatively_applied_to_every_linked_id", "did_not_apply_is_not_pass"])) fail("exact policy fields");
  if (matrix.policy.default_exit_requires_no_governance_pending !== true
      || matrix.policy.whole_test_file_failure_is_conservatively_applied_to_every_linked_id !== true
      || matrix.policy.did_not_apply_is_not_pass !== true) fail("matrix fail-closed policy");
  if (matrix.sources.acceptance_catalog_sha256 !== "2110DBC609F4D6C030DE6650E02AE2BBFE8C6D87EFEB0B5AE8CE5D09A0A9802D"
      || matrix.sources.acceptance_resolver_sha256 !== "1E43555A524ABB5A3B958F165EE52753FC2B6D8F545DEFC9C3988A75562BD1EA"
      || matrix.sources.destination_effective_sha256 !== "023D64267F476ACBD61B8611468C8D6AB0CC6DA8EE529C5CED6B19669D065E2D"
      || matrix.sources.postscan_correction_sha256 !== "A74C5D392F520970991E174366778AB3DD7609A3E6C5F09514A352A95C6A4684") fail("exact external source digests");
  const preregPath = path.join(repo, ...matrix.sources.preregistration_path.split("/"));
  try {
    const preregBytes = readFileSync(preregPath);
    if (preregBytes.length !== matrix.sources.preregistration_bytes
        || sha256(preregBytes) !== matrix.sources.preregistration_sha256) fail("preregistration bytes/hash");
    const prereg = JSON.parse(preregBytes.toString("utf8"));
    expectedIds = [...Object.keys(prereg.acceptance_rows), ...Object.keys(prereg.system_acceptance_rows)].sort();
  } catch (error) { fail(`preregistration source: ${error.message}`); }
  const actualIds = Object.keys(matrix.entries ?? {}).sort();
  if (expectedIds.length !== 40 || actualIds.length !== 40
      || expectedIds.join("|") !== actualIds.join("|") || matrix.policy.entry_count !== 40) fail("exact 40-ID denominator");

  const mapping = Object.fromEntries(Object.entries(matrix.entries ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => [id, { evidence_label: entry.evidence_label, test_files: entry.test_files }]));
  const mappingBytes = Buffer.from(`${JSON.stringify(mapping)}\n`, "utf8");
  if (mappingBytes.length !== matrix.policy.mapping_bytes
      || sha256(mappingBytes) !== matrix.policy.mapping_sha256
      || matrix.policy.mapping_bytes !== 7151
      || matrix.policy.mapping_sha256 !== "EC02F253761A63A36B6859DEF0EACD41D91DE0802627E741297D4832897EF13D") fail("exact ID-to-evidence mapping");

  for (const [id, entry] of Object.entries(matrix.entries ?? {})) {
    if (!exactKeys(entry, ["status", "evidence_label", "test_files"])) fail(`${id} exact fields`);
    if (!["candidate_measured", "candidate_measured_pending_correction"].includes(entry.status)) fail(`${id} status`);
    if (typeof entry.evidence_label !== "string" || entry.evidence_label.length === 0
        || !Array.isArray(entry.test_files) || entry.test_files.length === 0) fail(`${id} evidence/test files`);
    for (const relative of entry.test_files ?? []) testFiles.add(relative);
  }
  const postscan = matrix.entries?.["FM-SYS-SNAPSHOT-UNAVAILABLE"];
  if (matrix.sources.postscan_correction_status === "candidate_two_of_three") {
    if (matrix.sources.postscan_effective_path !== null || matrix.sources.postscan_effective_sha256 !== null
        || postscan?.status !== "candidate_measured_pending_correction") fail("postscan pending gate");
  } else if (matrix.sources.postscan_correction_status === "effective_three_of_three") {
    if (matrix.sources.postscan_effective_path !== "workbench/2026-09-08-app2-postscan-correction-effective/EFFECTIVE.json"
        || matrix.sources.postscan_effective_sha256 !== "1F8022DC299B660FFC0DDA565D1951AAD6E804B2916C318E3924842D55372E2F"
        || postscan?.status !== "candidate_measured") fail("postscan effective gate");
  } else fail("postscan correction status");
  if (!exactKeys(matrix.additional_gates, ["independent_tree_byte_oracle", "dynamic_subject_controls", "destination_io_boundary_split", "legacy_unpinned_destination_refusal", "executable_comparator"])) fail("exact additional gates");
  for (const [gate, files] of Object.entries(matrix.additional_gates ?? {})) {
    if (!Array.isArray(files) || files.length === 0) fail(`${gate} files`);
    for (const relative of files ?? []) testFiles.add(relative);
  }
  if (!exactKeys(matrix.native_artifacts, ["directory_picker", "recycle"])) fail("exact native artifact names");
  for (const [name, artifact] of Object.entries(matrix.native_artifacts ?? {})) {
    if (!exactKeys(artifact, ["status", "harness", "reason"])
        || !["measured", "NotMeasured"].includes(artifact.status)) fail(`${name} native artifact`);
    const full = path.resolve(repo, ...artifact.harness.split("/"));
    if (!existsSync(full)) fail(`${name} native artifact harness`);
  }
  if (matrix.native_artifacts.directory_picker.status !== "NotMeasured"
      || matrix.native_artifacts.recycle.status !== "measured") fail("native artifact status boundary");
}

function confinedFile(relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split("/").includes("..")) return null;
  const full = path.resolve(repo, ...relative.split("/"));
  const within = path.relative(repo, full);
  return within.startsWith("..") || path.isAbsolute(within) ? null : full;
}

const runs = new Map();
if (failures.length === 0) {
  for (const relative of [...testFiles].sort()) {
    const full = confinedFile(relative);
    if (!full || !existsSync(full)) { fail(`missing/confined test ${relative}`); continue; }
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", full], {
      cwd: repo,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const passed = Number(output.match(/# pass (\d+)/)?.[1] ?? 0);
    const failed = Number(output.match(/# fail (\d+)/)?.[1] ?? -1);
    const status = result.status === 0 && passed > 0 && failed === 0 ? "pass" : "fail";
    runs.set(relative, { status, passed, failed, exit: result.status, output });
    process.stdout.write(`${status} ${relative} (${passed} pass / ${failed} fail)\n`);
    if (status !== "pass") fail(`test file ${relative}`);
  }
}

let measured = 0;
let pending = 0;
if (matrix) {
  for (const [id, entry] of Object.entries(matrix.entries ?? {})) {
    if (entry.test_files.every((file) => runs.get(file)?.status === "pass")) measured += 1;
    if (entry.status === "candidate_measured_pending_correction") pending += 1;
  }
}

process.stdout.write(`\n40-ID behavior ${measured}/40; governance pending ${pending}\n`);
if (matrix?.native_artifacts?.directory_picker?.status === "NotMeasured") {
  process.stdout.write("native directory picker NotMeasured; stubbed evidence remains labeled stubbed\n");
}
if (failures.length) {
  for (const failure of failures) process.stdout.write(`FAIL ${failure}\n`);
  process.exit(1);
}
if (!behaviorOnly && pending > 0) {
  process.stdout.write("BLOCKED governance correction not yet effective\n");
  process.exit(1);
}
process.stdout.write(behaviorOnly ? "behavior-only control green\n" : "acceptance matrix green\n");
