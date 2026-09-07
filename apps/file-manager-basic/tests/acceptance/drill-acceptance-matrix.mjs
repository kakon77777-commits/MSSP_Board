import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const canonicalPath = path.join(here, "acceptance-matrix.json");
const verifier = path.join(here, "verify-acceptance-matrix.mjs");
const canonical = readFileSync(canonicalPath, "utf8");
const run = (subject, behaviorOnly = false) => spawnSync(
  process.execPath,
  [verifier, ...(behaviorOnly ? ["--behavior-only"] : []), ...(subject ? [subject] : [])],
  { encoding: "utf8", timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
);
const mutation = (label, change) => ({ label, change });
const attacks = [
  mutation("drop one acceptance ID", (value) => { delete value.entries["FM-ROOT-SELECT"]; }),
  mutation("add an unknown acceptance ID", (value) => { value.entries["FM-UNKNOWN"] = value.entries["FM-ROOT-SELECT"]; }),
  mutation("map a row to an unrelated green test", (value) => { value.entries["FM-ROOT-SELECT"].test_files = ["apps/file-manager-basic/tests/acceptance/tree-byte-oracle.test.mjs"]; }),
  mutation("empty one row evidence set", (value) => { value.entries["FM-ROOT-SELECT"].test_files = []; }),
  mutation("self-promote postscan without effective evidence", (value) => { value.entries["FM-SYS-SNAPSHOT-UNAVAILABLE"].status = "candidate_measured"; }),
  mutation("claim effective correction without a subject", (value) => { value.sources.postscan_correction_status = "effective_three_of_three"; }),
  mutation("relabel native picker NotMeasured as measured", (value) => { value.native_artifacts.directory_picker.status = "measured"; }),
  mutation("drop destination I/O split gate", (value) => { delete value.additional_gates.destination_io_boundary_split; }),
  mutation("change preregistration digest", (value) => { value.sources.preregistration_sha256 = "0".repeat(64); }),
  mutation("allow DID_NOT_APPLY to look like pass", (value) => { value.policy.did_not_apply_is_not_pass = false; }),
];

const control = run(null, true);
process.stdout.write(`control ${control.status === 0 ? "green" : "RED"}\n`);
if (control.status !== 0) {
  process.stdout.write(`${control.stdout ?? ""}${control.stderr ?? ""}`);
  process.exit(1);
}

let green = 0;
let errors = 0;
let didNotApply = 0;
for (const attack of attacks) {
  const value = JSON.parse(canonical);
  attack.change(value);
  const changed = `${JSON.stringify(value, null, 2)}\n`;
  if (changed === canonical) {
    process.stdout.write(`DID_NOT_APPLY ${attack.label}\n`);
    didNotApply += 1;
    continue;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), "app2-acceptance-matrix-drill-"));
  const subject = path.join(root, "acceptance-matrix.json");
  try {
    writeFileSync(subject, changed, "utf8");
    const result = run(subject);
    if (result.error) {
      process.stdout.write(`ERROR ${attack.label}: ${result.error.message}\n`);
      errors += 1;
    } else if (result.status === 0) {
      process.stdout.write(`GREEN ${attack.label}\n`);
      green += 1;
    } else process.stdout.write(`red ${attack.label}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const unchanged = readFileSync(canonicalPath, "utf8") === canonical;
process.stdout.write(`canonical unchanged ${unchanged}\n`);
process.stdout.write(`${attacks.length} attacks / ${green} green / ${errors} errors / ${didNotApply} did not apply\n`);
process.exit(unchanged && green === 0 && errors === 0 && didNotApply === 0 ? 0 : 1);
