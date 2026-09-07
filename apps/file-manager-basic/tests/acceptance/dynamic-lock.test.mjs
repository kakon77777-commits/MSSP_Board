import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withLockedMember } from "./support/dynamic-subjects.mjs";
import { materializeFixture } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-lock-";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("locked-member proves a sharing violation and releases only its helper", async () => {
  const root = mkdtempSync(scratchPrefix);
  const source = path.join(root, "partial", "locked.bin");
  const destination = path.join(root, "dest-move", "locked.bin");
  try {
    materializeFixture(root, manifest);
    const result = await withLockedMember(source, destination, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.ok(Number.isInteger(proof.helperPid) && proof.helperPid > 0);
      assert.match(proof.handle, /^0x[0-9a-f]+$/i);
      assert.equal(proof.controlMoveFailed, true);
      assert.match(proof.controlErrorCode, /EPERM|EACCES|EBUSY/);
      assert.equal(existsSync(source), true);
      assert.equal(existsSync(destination), false);
      assert.equal(
        sha256(readFileSync(source)),
        "f78d2b3f2e61b1f7ff5404b8e97589c3c7eb558fbd292900acd562aa58ebe9f8",
      );
      return "measured";
    });
    assert.equal(result.value, "measured");
    assert.equal(result.cleanupState, "released");
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(destination), false);
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("locked-member releases the exact helper when the callback throws", async () => {
  const root = mkdtempSync(scratchPrefix);
  const source = path.join(root, "partial", "locked.bin");
  const destination = path.join(root, "dest-move", "locked.bin");
  try {
    materializeFixture(root, manifest);
    await assert.rejects(
      withLockedMember(source, destination, async () => {
        throw new Error("measured action failed");
      }),
      /measured action failed/,
    );
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(destination), false);
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
