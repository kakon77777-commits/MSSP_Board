// Product-freshness attacks. A technically closed current portfolio record
// cannot keep publishing old measurements after its app or denominator moves.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const verifier = path.join(here, "verify-portfolio.mjs");
const closeCommit = "7366c4ec0e4404bbb571964adcdc139254df6c50";
const appTracked = path.join(repo, "apps", "text-editor-basic", "tests", "boundary-contract.test.mjs");
const denominator = path.join(repo, "slices", "01-text-editor-basic", "preregistration.json");
const untrackedTest = path.join(repo, "apps", "text-editor-basic", "tests", "portfolio-drift-probe.test.mjs");
const say = (line) => process.stdout.write(`${line}\n`);

function run(command, args) {
  return spawnSync(command, args, { cwd: repo, encoding: "utf8", timeout: 30_000 });
}

function verify() {
  const result = run(process.execPath, [verifier]);
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  if (result.status === 0) return { state: "green", first: output.split(/\r?\n/)[0] ?? "" };
  if (result.status === 1 && /^\s*FAIL\s/m.test(output)) {
    return { state: "red", first: output.match(/^\s*FAIL\s.*$/m)?.[0] ?? "FAIL" };
  }
  return { state: "error", first: result.error?.message ?? output.split(/\r?\n/)[0] ?? "error" };
}

function status() {
  const result = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.status !== 0) throw new Error(result.stderr || "git status failed");
  return result.stdout;
}

function trackedDriftExists(relative) {
  const result = run("git", ["diff", "--quiet", closeCommit, "--", relative]);
  if (![0, 1].includes(result.status)) throw new Error(result.stderr || `git diff status ${result.status}`);
  return result.status === 1;
}

function untrackedIsVisible(relative) {
  const result = run("git", ["ls-files", "--others", "--exclude-standard", "--", relative]);
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.trim().split(/\r?\n/).includes(relative);
}

const baselineStatus = status();
const control = verify();
say("\n=== portfolio product-drift drill ===\n");
say(`  control ... ${control.state}`);
if (control.state !== "green") process.exit(1);

const cases = [
  {
    name: "tracked App-1 test changes after close",
    file: appTracked,
    relative: "apps/text-editor-basic/tests/boundary-contract.test.mjs",
    mutate(original) { return Buffer.concat([original, Buffer.from("\n// tracked product drift\n")]); },
    prove(relative) { return trackedDriftExists(relative); },
  },
  {
    name: "tracked App-1 denominator changes after close",
    file: denominator,
    relative: "slices/01-text-editor-basic/preregistration.json",
    mutate(original) { return Buffer.concat([original, Buffer.from(" \n")]); },
    prove(relative) { return trackedDriftExists(relative); },
  },
  {
    name: "nonignored command-visible test appears after close",
    file: untrackedTest,
    relative: "apps/text-editor-basic/tests/portfolio-drift-probe.test.mjs",
    create: true,
    mutate() {
      return Buffer.from('import test from "node:test";\ntest("portfolio drift probe", () => {});\n');
    },
    prove(relative) { return untrackedIsVisible(relative); },
  },
];

let green = 0;
let errors = 0;
let didNotApply = 0;

for (const attack of cases) {
  if (attack.create && existsSync(attack.file)) {
    say(`  DID_NOT_APPLY  ${attack.name}: target already exists`);
    didNotApply += 1;
    continue;
  }
  const original = attack.create ? null : readFileSync(attack.file);
  try {
    writeFileSync(attack.file, attack.mutate(original));
    if (!attack.prove(attack.relative)) {
      say(`  DID_NOT_APPLY  ${attack.name}: drift proof stayed false`);
      didNotApply += 1;
      continue;
    }
    const outcome = verify();
    say(`  ${outcome.state.toUpperCase().padEnd(5)} ${attack.name}  ${outcome.first}`);
    if (outcome.state === "green") green += 1;
    if (outcome.state === "error") errors += 1;
  } finally {
    if (attack.create) rmSync(attack.file, { force: true });
    else writeFileSync(attack.file, original);
  }
  if (status() !== baselineStatus) {
    say(`  ERROR restoration changed git status after ${attack.name}`);
    errors += 1;
  }
}

const restored = verify();
say(`\n  restored control ... ${restored.state}`);
say(`  ${cases.length} attacks   ${green} green   ${errors} errors   ${didNotApply} did not apply`);
process.exit(green === 0 && errors === 0 && didNotApply === 0
  && restored.state === "green" && status() === baselineStatus ? 0 : 1);
