// Cross-file evidence attacks. These cases intentionally change both a claim
// and the local snapshot that used to justify it, then regenerate projections.
// A stale generated file or stale digest is therefore not allowed to provide
// the RED.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const productPath = path.join(here, "products", "01-text-editor-basic.json");
const executionPath = path.join(here, "evidence", "2026-08-30-text-editor-execution.json");
const verifier = path.join(here, "verify-portfolio.mjs");
const renderer = path.join(here, "render-index.mjs");
const say = (line) => process.stdout.write(`${line}\n`);

function runNode(file) {
  return spawnSync(process.execPath, [file], { cwd: repo, encoding: "utf8", timeout: 30_000 });
}

function verify() {
  const run = runNode(verifier);
  const output = `${run.stderr ?? ""}\n${run.stdout ?? ""}`.trim();
  if (run.status === 0) return { state: "green", first: output.split(/\r?\n/)[0] ?? "" };
  if (run.status === 1 && /^\s*FAIL\s/m.test(output)) {
    return { state: "red", first: output.match(/^\s*FAIL\s.*$/m)?.[0] ?? "FAIL" };
  }
  return { state: "error", first: run.error?.message ?? output.split(/\r?\n/)[0] ?? "error" };
}

function render() {
  const run = runNode(renderer);
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || "render failed");
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function bindExecution(record, executionText) {
  const bytes = Buffer.from(executionText, "utf8");
  record.measured_evidence.bytes = bytes.byteLength;
  record.measured_evidence.sha256 = createHash("sha256").update(bytes).digest("hex");
}

const cases = [
  {
    name: "system-acceptance owner aliases build owner with trailing space",
    mutate(record) { record.owners.system_acceptance = `${record.owners.build} `; },
  },
  {
    name: "system-acceptance owner aliases build owner by case",
    mutate(record) { record.owners.system_acceptance = record.owners.build.toLowerCase(); },
  },
  {
    name: "execution snapshot and record invent one test",
    mutate(record, execution) {
      execution.commands.find((command) => command.id === "npm-test").tests = 1;
      record.measured.tests = 1;
    },
  },
  {
    name: "execution command is replaced by echo fabricated",
    mutate(_record, execution) {
      execution.commands.find((command) => command.id === "npm-test").command = "echo fabricated";
    },
  },
  {
    name: "outsourced candidate operand becomes arbitrary and record follows",
    mutate(record, execution) {
      execution.outsourced_units[0].candidate_sha256 = "0".repeat(64);
      record.measured.outsourced_units_byte_identical = false;
    },
  },
];

say("\n=== portfolio evidence-subject drill ===\n");
const control = verify();
say(`  control ... ${control.state}`);
if (control.state !== "green") process.exit(1);

const originalProduct = readFileSync(productPath, "utf8");
const originalExecution = readFileSync(executionPath, "utf8");
let green = 0;
let errors = 0;
let didNotApply = 0;

for (const attack of cases) {
  try {
    const record = JSON.parse(originalProduct);
    const execution = JSON.parse(originalExecution);
    attack.mutate(record, execution);
    const executionText = jsonText(execution);
    bindExecution(record, executionText);
    const productText = jsonText(record);
    if (productText === originalProduct && executionText === originalExecution) {
      say(`  DID_NOT_APPLY  ${attack.name}`);
      didNotApply += 1;
      continue;
    }
    writeFileSync(executionPath, executionText, "utf8");
    writeFileSync(productPath, productText, "utf8");
    render();
    const outcome = verify();
    say(`  ${outcome.state.toUpperCase().padEnd(5)} ${attack.name}  ${outcome.first}`);
    if (outcome.state === "green") green += 1;
    if (outcome.state === "error") errors += 1;
  } finally {
    writeFileSync(productPath, originalProduct, "utf8");
    writeFileSync(executionPath, originalExecution, "utf8");
    render();
  }
}

const restored = verify();
say(`\n  restored control ... ${restored.state}`);
say(`  ${cases.length} attacks   ${green} green   ${errors} errors   ${didNotApply} did not apply`);
process.exit(green === 0 && errors === 0 && didNotApply === 0
  && restored.state === "green" ? 0 : 1);
