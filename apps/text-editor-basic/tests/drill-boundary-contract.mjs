// Prove the A2 boundary-contract tests can fail.
//
//   node tests/drill-boundary-contract.mjs
//
// Six green tests are not evidence until each defect they exist to catch is
// planted and shown to turn them red. Two of the mutations below are not
// hypothetical: the Save-As ordering and the swallowed handshake were both real,
// both shipped compiling, and both passed the 62-test suite that existed before
// this contract had any test at all.
//
// A mutation that leaves the suite green is either a hole in the tests or an
// edit that changes no answer. Both print green, so any green here is read by
// hand and never counted as a pass.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const SUITE = path.join(here, "boundary-contract.test.mjs");
const say = (line) => process.stdout.write(line + "\n");

const MUTATIONS = [
  {
    name: "Save builds its boundary before updating current",
    file: "src/main/main.ts",
    from: `  current = {
    ...current,
    filePath: path.resolve(target),
    dirty: dirtyRevision !== started.dirtyRevision,
  };
  return accepted(operation);`,
    to: `  const early = accepted(operation);
  current = {
    ...current,
    filePath: path.resolve(target),
    dirty: dirtyRevision !== started.dirtyRevision,
  };
  return early;`,
  },
  {
    name: "an accepted operation does not advance the generation",
    file: "src/main/main.ts",
    from: "): DocumentOperationResult {\n  boundaryGeneration += 1;",
    to: "): DocumentOperationResult {",
  },
  {
    name: "a refusal advances the generation",
    file: "src/main/main.ts",
    from: `): DocumentOperationResult {
  return {
    status: "refused", operation, refusal,`,
    to: `): DocumentOperationResult {
  boundaryGeneration += 1;
  return {
    status: "refused", operation, refusal,`,
  },
  {
    name: "a cancellation advances the generation",
    file: "src/main/main.ts",
    from: `function cancelled(operation: DocumentOperation): DocumentOperationResult {
  return {`,
    to: `function cancelled(operation: DocumentOperation): DocumentOperationResult {
  boundaryGeneration += 1;
  return {`,
  },
  {
    name: "the initial handshake never runs",
    file: "src/dms/encoding-visibility-bridge.ts",
    // Compilable on purpose. An unreachable `return` is rejected by tsc, and a
    // mutation rejected at compile proves the compiler caught it while saying
    // nothing about whether the test would have.
    from: "    renderBoundary(await getDocumentFormatState(), null);",
    to: "    void (await getDocumentFormatState());",
  },
  {
    name: "the refusal is never handed to the projection",
    file: "src/renderer/renderer.ts",
    from: "project(result.boundary, result.status === \"refused\" ? result.refusal : null);",
    to: "project(result.boundary, null);",
  },
  {
    name: "the byte count is dropped on the way to the window",
    file: "src/main/boundary-snapshot.ts",
    from: "    format: { ...format, schema: SCHEMA },",
    to: "    format: { ...format, rawByteLength: null, schema: SCHEMA },",
  },
  {
    name: "a stale refusal is left on screen after a success",
    file: "src/dms/encoding-visibility.ts",
    from: null,   // filled in below: the candidate's own wording is read, not guessed
    to: null,
  },
];

// The last mutation targets P1/P3 candidate source, whose bytes are verified and
// must not be edited even temporarily. It is dropped rather than approximated:
// a drill that quietly tests something else is worse than one case fewer.
MUTATIONS.pop();

function runSuite() {
  const built = spawnSync(process.execPath,
    [path.join(app, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    { cwd: app, encoding: "utf8" });
  if (built.status !== 0) return "compile";
  const dms = spawnSync(process.execPath,
    [path.join(app, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.dms.json"],
    { cwd: app, encoding: "utf8" });
  if (dms.status !== 0) return "compile";
  execFileSync(process.execPath, [path.join(app, "scripts", "render-renderer.mjs")],
    { cwd: app, stdio: "pipe" });
  const suite = spawnSync(process.execPath, ["--test", SUITE], { cwd: app, encoding: "utf8" });
  return suite.status === 0 ? "green" : "red";
}

say("\n=== drill-boundary-contract — can the A2 contract tests fail?\n");
say(`  control (nothing mutated) ... ${runSuite()}`);

let green = 0;
let didNotApply = 0;
for (const mutation of MUTATIONS) {
  const file = path.join(app, mutation.file);
  const original = readFileSync(file, "utf8");
  if (!original.includes(mutation.from)) {
    say(`  DID NOT APPLY  ${mutation.name}`);
    didNotApply += 1;
    continue;
  }
  writeFileSync(file, original.replace(mutation.from, mutation.to), "utf8");
  let outcome;
  try {
    outcome = runSuite();
  } finally {
    // Restore before anything else can observe the tree. A killed drill that
    // skipped this once left a planted defect behind and the next run reported
    // on a subject nobody meant to test.
    writeFileSync(file, original, "utf8");
  }
  if (outcome === "green") {
    say(`  GREEN (hole or no-op)  ${mutation.name}`);
    green += 1;
  } else {
    say(`  red   ${mutation.name.padEnd(56)}${outcome === "compile" ? "(rejected at compile)" : ""}`);
  }
}

const restored = runSuite();
say(`\n  restored control ... ${restored}`);
say(`  ${MUTATIONS.length} mutations   ${green} green   ${didNotApply} did not apply`);
process.exit(green === 0 && didNotApply === 0 && restored === "green" ? 0 : 1);
