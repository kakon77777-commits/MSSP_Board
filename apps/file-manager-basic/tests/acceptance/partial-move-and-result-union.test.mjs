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

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("FM-MOVE-PARTIAL distinguishes one locked failure from a mixed partial batch", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    await chooseRoot(page);
    await page.locator("#pin-target").selectOption({ label: "dest-move" });
    const pinned = await performAndRead(page, () => page.locator("#set-destination").click());
    assert.equal(pinned.status, "accepted");
    assert.equal(pinned.snapshot.snapshot.generation, 2);

    const partial = pinned.snapshot.snapshot.entries.find((entry) => entry.name === "partial");
    const nested = await performAndRead(
      page,
      () => page.locator(`#entries li[data-entry-id=${JSON.stringify(partial.entryId)}] button.entry-open`).click(),
    );
    assert.equal(nested.status, "accepted");
    assert.equal(nested.snapshot.snapshot.generation, 3);

    const sourceLocked = path.join(root, "partial", "locked.bin");
    const destinationLocked = path.join(root, "dest-move", "locked.bin");
    const measured = await withLockedMember(sourceLocked, destinationLocked, async ({ proof }) => {
      assert.equal(proof.preconditionState, "proven");
      assert.equal(proof.controlMoveFailed, true);

      await selectEntry(page, "locked.bin");
      const failed = await performAndRead(page, () => page.locator("#move-entries").click());
      assert.equal(failed.overallStatus, "failed");
      assert.deepEqual(failed.outcomes.map((outcome) => outcome.status), ["failed"]);
      assert.deepEqual(failed.outcomes.map((outcome) => outcome.code), ["filesystem_operation_failed"]);
      assert.equal(failed.snapshot.state, "unchanged");
      assert.equal(failed.snapshot.snapshot.generation, 3);
      assert.equal(existsSync(sourceLocked), true);
      assert.equal(existsSync(destinationLocked), false);

      await selectEntry(page, "locked.bin");
      await selectEntry(page, "ok.bin");
      const mixed = await performAndRead(page, () => page.locator("#move-entries").click());
      assert.equal(mixed.overallStatus, "partial");
      assert.deepEqual(mixed.outcomes.map((outcome) => outcome.status), ["failed", "accepted"]);
      assert.deepEqual(mixed.outcomes.map((outcome) => outcome.ordinal), [0, 1]);
      assert.equal(mixed.snapshot.state, "current");
      assert.equal(mixed.snapshot.snapshot.generation, 4);
      return { failed, mixed };
    });

    assert.equal(measured.cleanupState, "released");
    assert.equal(existsSync(path.join(root, "partial", "ok.bin")), false);
    assert.equal(existsSync(path.join(root, "dest-move", "ok.bin")), true);
    assert.deepEqual(
      readFileSync(path.join(root, "dest-move", "ok.bin")),
      Buffer.from("deadbeef00112233", "hex"),
    );
    assert.equal(existsSync(sourceLocked), true);
    assert.equal(existsSync(destinationLocked), false);
  } finally {
    await harness.close();
  }
});
