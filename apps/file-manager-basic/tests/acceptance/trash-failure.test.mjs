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
import { withLockedMember } from "./support/dynamic-subjects.mjs";
import { findExactRecycleItems } from "./support/recycle-bin-evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const expected = Buffer.from(
  manifest.entries.find((entry) => entry.path === "partial/trash-locked.txt").payload_hex,
  "hex",
);

test("FM-TRASH-REFUSE reports a proven native recycle failure without permanent-delete fallback", async () => {
  const harness = await launchPackagedFixture(manifest);
  const source = path.join(harness.root, "partial", "trash-locked.txt");
  const renameControl = path.join(harness.root, "partial", "trash-control-destination.txt");
  try {
    await chooseRoot(harness.page);
    const nested = await performAndRead(
      harness.page,
      () => harness.page.locator('#entries li[data-name="partial"] button.entry-open').click(),
    );
    assert.equal(nested.snapshot.snapshot.generation, 2);

    const measured = await withLockedMember(source, renameControl, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.equal(proof.controlMoveFailed, true);
      const recycleControl = await harness.electronApp.evaluate(async ({ shell }, subject) => {
        try {
          await shell.trashItem(subject);
          return { status: "unexpected_success" };
        } catch (error) {
          return { status: "failed", code: error?.code ?? error?.name ?? "Error" };
        }
      }, source);
      assert.equal(recycleControl.status, "failed");
      assert.equal(existsSync(source), true);
      assert.deepEqual(findExactRecycleItems(source), []);

      await selectEntry(harness.page, "trash-locked.txt");
      return performAndRead(harness.page, () => harness.page.locator("#trash-entries").click());
    });

    assert.equal(measured.cleanupState, "released");
    assert.equal(measured.value.overallStatus, "failed");
    assert.deepEqual(measured.value.outcomes.map((outcome) => outcome.status), ["failed"]);
    assert.deepEqual(measured.value.outcomes.map((outcome) => outcome.code), ["recycle_failed"]);
    assert.equal(measured.value.snapshot.state, "unchanged");
    assert.equal(measured.value.snapshot.snapshot.generation, 2);
    assert.equal(existsSync(source), true);
    assert.deepEqual(readFileSync(source), expected);
    assert.deepEqual(findExactRecycleItems(source), []);
    assert.equal(existsSync(renameControl), false);
  } finally {
    await harness.close();
  }
});
