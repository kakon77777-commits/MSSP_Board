import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withRefreshChange } from "./support/dynamic-subjects.mjs";
import { materializeFixture } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-refresh-";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("refresh-change proves the before state, performs exact external changes, and restores", async () => {
  const root = mkdtempSync(scratchPrefix);
  const base = path.join(root, "refresh", "base.txt");
  const added = path.join(root, "refresh", "external-added.bin");
  try {
    materializeFixture(root, manifest);
    const result = await withRefreshChange(root, manifest, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.equal(proof.baseSha256, "f34848ca92665c342abd5816c9e3eda0e82180671195362bcd0080544a3bc2ac");
      assert.equal(proof.addedWasAbsent, true);
      assert.equal(existsSync(base), false);
      assert.equal(existsSync(added), true);
      assert.equal(readFileSync(added).length, 4);
      assert.equal(
        sha256(readFileSync(added)),
        "97ed8e55519b020c4d9aceb40e0d3bc7eaa22d080d49592bf21206cb697c8a58",
      );
      return "measured";
    });
    assert.equal(result.value, "measured");
    assert.equal(result.cleanupState, "restored");
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refresh-change restores exact bytes when the callback throws", async () => {
  const root = mkdtempSync(scratchPrefix);
  try {
    materializeFixture(root, manifest);
    await assert.rejects(
      withRefreshChange(root, manifest, async () => {
        throw new Error("measured action failed");
      }),
      /measured action failed/,
    );
    assert.equal(verifyTree(root, manifest).status, "match");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refresh-change cleanup refuses to erase a changed external artifact", async () => {
  const root = mkdtempSync(scratchPrefix);
  try {
    materializeFixture(root, manifest);
    await assert.rejects(
      withRefreshChange(root, manifest, async ({ addedPath }) => {
        writeFileSync(addedPath, Buffer.from("00000000", "hex"));
      }),
      /refuses to delete changed added artifact/,
    );
    assert.equal(existsSync(path.join(root, "refresh", "external-added.bin")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
