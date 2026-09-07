import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withEscapeJunction } from "./support/dynamic-subjects.mjs";
import { materializeFixture } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-junction-";

test("escape-junction proves an outside target and restores the exact fixture", () => {
  const root = mkdtempSync(scratchPrefix);
  const runId = crypto.randomUUID();
  let target = null;
  try {
    materializeFixture(root, manifest);
    const result = withEscapeJunction(root, runId, ({ linkPath, targetPath, proof }) => {
      target = targetPath;
      assert.equal(proof.preconditionState, "proven");
      assert.equal(proof.kind, "reparse");
      assert.equal(proof.targetOutsideRoot, true);
      assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
      assert.equal(realpathSync(linkPath), realpathSync(targetPath));
      assert.equal(
        realpathSync(targetPath).startsWith(`${realpathSync(root)}${path.sep}`),
        false,
      );
      const during = verifyTree(root, manifest);
      assert.equal(during.status, "mismatch");
      assert.deepEqual(during.mismatches, [{
        path: "escape-junction",
        kind: "unexpected",
        expected: null,
        actual: "reparse",
      }]);
      return "callback-complete";
    });
    assert.equal(result.value, "callback-complete");
    assert.equal(result.cleanupState, "restored");
    assert.equal(existsSync(path.join(root, "escape-junction")), false);
    assert.equal(target === null ? true : existsSync(target), false);
    assert.deepEqual(verifyTree(root, manifest), {
      status: "match",
      checkedEntries: 30,
      mismatches: [],
    });
  } finally {
    const resolved = path.resolve(root).replaceAll("\\", "/");
    assert.ok(resolved.startsWith(scratchPrefix));
    rmSync(root, { recursive: true, force: true });
    if (target !== null && existsSync(target)) {
      const normalizedTarget = path.resolve(target).replaceAll("\\", "/");
      assert.ok(normalizedTarget.startsWith("D:/Ai/work together/escape-target-"));
      rmSync(target, { recursive: true, force: true });
    }
  }
});

test("escape-junction cleanup runs when the measured action throws", () => {
  const root = mkdtempSync(scratchPrefix);
  const runId = crypto.randomUUID();
  const target = path.join("D:/Ai/work together", `escape-target-${runId}`);
  try {
    materializeFixture(root, manifest);
    assert.throws(() => withEscapeJunction(root, runId, () => {
      throw new Error("measured action failed");
    }), /measured action failed/);
    assert.equal(existsSync(path.join(root, "escape-junction")), false);
    assert.equal(existsSync(target), false);
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
});

test("escape-junction cleanup refuses to erase an unexpected target child", () => {
  const root = mkdtempSync(scratchPrefix);
  const runId = crypto.randomUUID();
  const target = path.join("D:/Ai/work together", `escape-target-${runId}`);
  const unexpected = path.join(target, "unexpected.txt");
  try {
    materializeFixture(root, manifest);
    assert.throws(() => withEscapeJunction(root, runId, ({ targetPath }) => {
      writeFileSync(path.join(targetPath, "unexpected.txt"), "preserve me\n", "utf8");
    }), /directory not empty|not empty/i);
    assert.equal(existsSync(path.join(root, "escape-junction")), false);
    assert.equal(existsSync(unexpected), true);
    assert.equal(readFileSync(unexpected, "utf8"), "preserve me\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
});
