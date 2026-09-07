import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chooseRoot, launchPackagedFixture } from "./support/packaged-harness.mjs";
import { withEscapeJunctionAsync } from "./support/dynamic-subjects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

function assertPriorGeneration(result, generation) {
  assert.equal(result.prior?.snapshot.generation, generation);
  assert.equal(result.prior?.snapshot.root.displayName.startsWith(".mssp-app2-gui-"), true);
}

test("FM-ROOT-CANCEL and FM-ROOT-REFUSE preserve an already-current root", async () => {
  const harness = await launchPackagedFixture(manifest, {
    rootSequence: (root) => [
      root,
      null,
      path.join(root, "copy-file.bin"),
      path.join(root, "missing"),
    ],
  });
  try {
    const initial = await chooseRoot(harness.page);
    assert.equal(initial.status, "accepted");
    assert.equal(initial.snapshot.generation, 1);

    const cancelled = await chooseRoot(harness.page);
    assert.equal(cancelled.status, "cancelled");
    assertPriorGeneration(cancelled, 1);

    for (let index = 0; index < 2; index += 1) {
      const refused = await chooseRoot(harness.page);
      assert.equal(refused.status, "refused");
      assert.equal(refused.code, "path_rejected");
      assertPriorGeneration(refused, 1);
    }
  } finally {
    await harness.close();
  }
});

test("FM-ROOT-FAIL keeps A when B initial scan fails and later admits the same B control", async () => {
  const harness = await launchPackagedFixture(manifest, {
    rootSequence: (root) => [root, path.join(root, "nav"), path.join(root, "nav")],
    failScanAt: 2,
  });
  try {
    const initial = await chooseRoot(harness.page);
    assert.equal(initial.status, "accepted");
    assert.equal(initial.snapshot.generation, 1);

    const failed = await chooseRoot(harness.page);
    assert.equal(failed.status, "failed");
    assert.equal(failed.code, "root_snapshot_read_failed");
    assertPriorGeneration(failed, 1);

    const control = await chooseRoot(harness.page);
    assert.equal(control.status, "accepted");
    assert.equal(control.snapshot.generation, 2);
    assert.equal(control.snapshot.root.displayName, "nav");
    assert.deepEqual(control.snapshot.entries.map((entry) => entry.name), ["child.txt"]);
  } finally {
    await harness.close();
  }
});

test("FM-ROOT-REPARSE refuses a selected junction and preserves the current root", async () => {
  const harness = await launchPackagedFixture(manifest, {
    rootSequence: (root) => [root, path.join(root, "escape-junction")],
  });
  try {
    const initial = await chooseRoot(harness.page);
    assert.equal(initial.status, "accepted");
    assert.equal(initial.snapshot.generation, 1);

    const observed = await withEscapeJunctionAsync(harness.root, randomUUID(), async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.equal(proof.kind, "reparse");
      assert.equal(proof.targetOutsideRoot, true);
      return chooseRoot(harness.page);
    });
    assert.equal(observed.cleanupState, "restored");
    assert.equal(observed.value.status, "refused");
    assert.equal(observed.value.code, "reparse_refused");
    assertPriorGeneration(observed.value, 1);
  } finally {
    await harness.close();
  }
});
