// Prove build:check can detect a stale or tampered compiled DMS artifact.
//
// This drill changes only ignored dist output, never source. It establishes a
// green built control, plants one byte-visible mutation without rebuilding,
// requires build:check to fail for the DMS artifact, restores in finally, and
// requires byte-identical plus green controls afterwards.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const artifact = path.join(app, "dist", "dms", "encoding-visibility.js");
const tsc = path.join(app, "node_modules", "typescript", "bin", "tsc");
const renderer = path.join(app, "scripts", "render-renderer.mjs");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function nodeRun(args) {
  return spawnSync(process.execPath, args, {
    cwd: app,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function build() {
  for (const args of [
    [tsc, "-p", "tsconfig.json"],
    [tsc, "-p", "tsconfig.dms.json"],
    [renderer],
  ]) {
    const result = nodeRun(args);
    if (result.status !== 0) return result;
  }
  return { status: 0, stdout: "", stderr: "" };
}

const buildCheck = () => nodeRun([renderer, "--check"]);

function gitStatus() {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: app,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const built = build();
assert.equal(built.status, 0, built.stderr || built.stdout);

const beforeStatus = gitStatus();
const pristine = readFileSync(artifact);
const pristineHash = sha256(pristine);

const control = buildCheck();
assert.equal(control.status, 0, control.stderr || control.stdout);
process.stdout.write("  control: green\n");

const marker = Buffer.from("\n// PRAGMA_DMS_STALE_ARTIFACT_MUTATION\n", "utf8");
const mutated = Buffer.concat([pristine, marker]);
assert.notEqual(sha256(mutated), pristineHash, "mutation did not change artifact bytes");

let mutatedCheck;
try {
  writeFileSync(artifact, mutated);
  assert.deepEqual(readFileSync(artifact), mutated, "mutation did not apply exactly");
  mutatedCheck = buildCheck();
  assert.notEqual(mutatedCheck.status, 0,
    "build:check stayed green after compiled DMS mutation");
  const diagnostic = `${mutatedCheck.stdout}\n${mutatedCheck.stderr}`;
  assert.match(diagnostic, /dist\/dms/i,
    "red check did not identify the DMS artifact boundary");
  assert.match(diagnostic, /encoding-visibility\.js/i,
    "red check did not identify the mutated artifact");
  process.stdout.write("  mutated artifact: red\n");
} finally {
  writeFileSync(artifact, pristine);
}

const restored = readFileSync(artifact);
assert.deepEqual(restored, pristine, "artifact was not restored byte-identically");
assert.equal(sha256(restored), pristineHash, "restored artifact hash changed");
assert.equal(gitStatus(), beforeStatus, "drill changed tracked worktree state");
process.stdout.write(`  restored bytes: true (${pristineHash})\n`);

const restoredControl = buildCheck();
assert.equal(restoredControl.status, 0,
  restoredControl.stderr || restoredControl.stdout);
process.stdout.write("  restored control: green\n");
