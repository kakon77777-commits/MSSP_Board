import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

const rootNames = manifest.entries
  .filter((entry) => !entry.path.includes("/"))
  .map((entry) => entry.path)
  .sort((a, b) => a.localeCompare(b));

test("packaged root/view/navigation and selection use current opaque identities", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    assert.equal(await page.locator("#root-label").textContent(), "No root selected");
    const selected = await chooseRoot(page);
    assert.equal(selected.status, "accepted");
    assert.equal(selected.snapshot.generation, 1);
    assert.equal(selected.snapshot.completeness, "complete");
    assert.equal(selected.evidencePath, "stubbed");
    assert.equal((await page.locator("body").textContent()).includes(root), false);
    assert.deepEqual(
      await page.locator("#entries li").evaluateAll((rows) => rows.map((row) => row.dataset.name)),
      rootNames,
    );

    const single = await selectEntry(page, "copy-file.bin");
    assert.equal(single.status, "accepted");
    assert.equal(single.currentSnapshot.generation, 1);
    assert.equal(single.outcomes.length, 1);
    const multi = await selectEntry(page, "move-file.txt");
    assert.equal(multi.status, "accepted");
    assert.equal(multi.currentSnapshot.generation, 1);
    assert.equal(multi.outcomes.length, 2);

    const into = await performAndRead(
      page,
      () => page.locator('#entries li[data-name="nav"] button.entry-open').click(),
    );
    assert.equal(into.status, "accepted");
    assert.equal(into.snapshot.state, "current");
    assert.equal(into.snapshot.snapshot.generation, 2);
    assert.deepEqual(
      await page.locator("#entries li").evaluateAll((rows) => rows.map((row) => row.dataset.name)),
      ["child.txt"],
    );
    const parent = await performAndRead(page, () => page.locator("#navigate-parent").click());
    assert.equal(parent.status, "accepted");
    assert.equal(parent.snapshot.snapshot.generation, 3);
    const above = await performAndRead(page, () => page.locator("#navigate-parent").click());
    assert.equal(above.status, "refused");
    assert.equal(above.code, "navigate_above_root");
    assert.equal(above.snapshot.state, "unchanged");
    assert.equal(above.snapshot.snapshot.generation, 3);
  } finally {
    await harness.close();
  }
});

test("packaged root cancellation and invalid selected roots stay distinct", async () => {
  for (const [stubRoot, expectedStatus, expectedCode] of [
    ["__CANCEL__", "cancelled", null],
    [(root) => path.join(root, "copy-file.bin"), "refused", "path_rejected"],
    [(root) => path.join(root, "missing"), "refused", "path_rejected"],
  ]) {
    const harness = await launchPackagedFixture(manifest, { stubRoot });
    try {
      const result = await chooseRoot(harness.page);
      assert.equal(result.status, expectedStatus);
      if (expectedCode === null) assert.equal(Object.hasOwn(result, "code"), false);
      else assert.equal(result.code, expectedCode);
      assert.equal(result.prior, null);
      assert.equal(result.evidencePath, "stubbed");
    } finally {
      await harness.close();
    }
  }
});

test("refresh publishes unchanged and external snapshots and rejects old identities", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    await chooseRoot(page);
    const unchanged = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(unchanged.status, "accepted");
    assert.equal(unchanged.snapshot.snapshot.generation, 2);
    const intoRefresh = await performAndRead(
      page,
      () => page.locator('#entries li[data-name="refresh"] button.entry-open').click(),
    );
    assert.equal(intoRefresh.snapshot.snapshot.generation, 3);
    assert.deepEqual(
      intoRefresh.snapshot.snapshot.entries.map((entry) => entry.name),
      ["base.txt"],
    );
    const oldId = intoRefresh.snapshot.snapshot.entries[0].entryId;

    await withRefreshChange(root, manifest, async () => {
      const changed = await performAndRead(page, () => page.locator("#refresh").click());
      assert.equal(changed.status, "accepted");
      assert.equal(changed.snapshot.snapshot.generation, 4);
      const names = changed.snapshot.snapshot.entries.map((entry) => entry.name);
      assert.deepEqual(names, ["external-added.bin"]);

      const stale = await page.evaluate(
        ({ entryId }) => window.fileManager.setSelection(3, [{ ordinal: 0, submittedEntryId: entryId }]),
        { entryId: oldId },
      );
      assert.equal(stale.status, "refused");
      assert.equal(stale.code, "stale_generation");
      assert.equal(stale.outcomes[0].code, "cross_generation_entry_id");
      assert.equal(stale.currentSnapshot.generation, 4);
    });
  } finally {
    await harness.close();
  }
});
