import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  launchPackagedFixture,
  performAndRead,
  selectEntry,
} from "./support/packaged-harness.mjs";
import { withRefreshChange } from "./support/dynamic-subjects.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("FM-SYS-SNAPSHOT-SEQUENCE increments once per publication and never means mutation", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    const initial = await chooseRoot(page);
    assert.equal(initial.snapshot.generation, 1);
    assert.equal(verifyTree(root, manifest).status, "match");

    const unchanged = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(unchanged.status, "accepted");
    assert.equal(unchanged.snapshot.snapshot.generation, 2);
    assert.equal(verifyTree(root, manifest).status, "match");

    const intoRefresh = await performAndRead(
      page,
      () => page.locator('#entries li[data-name="refresh"] button.entry-open').click(),
    );
    assert.equal(intoRefresh.snapshot.snapshot.generation, 3);

    const changed = await withRefreshChange(root, manifest, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      return performAndRead(page, () => page.locator("#refresh").click());
    });
    assert.equal(changed.cleanupState, "restored");
    assert.equal(changed.value.status, "accepted");
    assert.equal(changed.value.snapshot.snapshot.generation, 4);
    assert.deepEqual(changed.value.snapshot.snapshot.entries.map((entry) => entry.name), ["external-added.bin"]);
    assert.equal(verifyTree(root, manifest).status, "match");

    const backAtRoot = await performAndRead(page, () => page.locator("#navigate-parent").click());
    assert.equal(backAtRoot.snapshot.snapshot.generation, 5);
    await page.locator("#pin-target").selectOption({ label: "dest-copy" });
    const pinned = await performAndRead(page, () => page.locator("#set-destination").click());
    assert.equal(pinned.snapshot.snapshot.generation, 6);

    await selectEntry(page, "copy-file.bin");
    const copied = await performAndRead(page, () => page.locator("#copy-entries").click());
    assert.equal(copied.overallStatus, "accepted");
    assert.equal(copied.snapshot.snapshot.generation, 7);
    assert.equal(existsSync(path.join(root, "dest-copy", "copy-file.bin")), true);
    assert.deepEqual(
      readFileSync(path.join(root, "dest-copy", "copy-file.bin")),
      readFileSync(path.join(root, "copy-file.bin")),
    );
  } finally {
    await harness.close();
  }
});
