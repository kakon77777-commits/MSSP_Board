import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withUnreadableEntry } from "./support/dynamic-subjects.mjs";
import { materializeFixture } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-acl-";

test("unreadable-entry proves denial, preserves a readable sibling, and restores ACL", async () => {
  const root = mkdtempSync(scratchPrefix);
  const target = path.join(root, "partial", "unreadable.bin");
  const sibling = path.join(root, "partial", "ok.bin");
  try {
    materializeFixture(root, manifest);
    const result = await withUnreadableEntry(target, sibling, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.match(proof.aclBeforeSha256, /^[0-9a-f]{64}$/);
      assert.match(proof.aclDeniedSha256, /^[0-9a-f]{64}$/);
      assert.notEqual(proof.aclBeforeSha256, proof.aclDeniedSha256);
      assert.match(proof.controlReadErrorCode, /EACCES|EPERM/);
      assert.throws(() => readFileSync(target), /access|permission|permitted/i);
      assert.doesNotThrow(() => readFileSync(sibling));
      return "measured";
    });
    assert.equal(result.value, "measured");
    assert.equal(result.cleanupState, "acl-restored");
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unreadable-entry restores ACL when the measured callback throws", async () => {
  const root = mkdtempSync(scratchPrefix);
  const target = path.join(root, "partial", "unreadable.bin");
  const sibling = path.join(root, "partial", "ok.bin");
  try {
    materializeFixture(root, manifest);
    await assert.rejects(
      withUnreadableEntry(target, sibling, async () => {
        throw new Error("measured action failed");
      }),
      /measured action failed/,
    );
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
