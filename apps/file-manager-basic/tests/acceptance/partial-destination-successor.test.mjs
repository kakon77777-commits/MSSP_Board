import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chooseRoot, launchPackagedFixture, performAndRead } from "./support/packaged-harness.mjs";
import { withUnreadableEntry } from "./support/dynamic-subjects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("pinned destination is reissued with nested source IDs and reaches partial copy", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    const selected = await chooseRoot(page);
    assert.equal(selected.snapshot.generation, 1);
    const destination = selected.snapshot.entries.find((entry) => entry.name === "dest-copy");

    const pinned = await performAndRead(
      page,
      () => page.locator("#destination").selectOption(destination.entryId),
    );
    assert.equal(pinned.operation, "set-destination");
    assert.equal(pinned.status, "accepted");
    assert.equal(pinned.snapshot.state, "current");
    assert.equal(pinned.snapshot.snapshot.generation, 2);
    assert.deepEqual(
      {
        state: pinned.snapshot.snapshot.destinationProjection.state,
        displayName: pinned.snapshot.snapshot.destinationProjection.displayName,
        isRoot: pinned.snapshot.snapshot.destinationProjection.isRoot,
      },
      { state: "current", displayName: "dest-copy", isRoot: false },
    );
    const destinationAt2 = pinned.snapshot.snapshot.destinationProjection.entryId;
    assert.notEqual(destinationAt2, destination.entryId);

    const partialAt2 = pinned.snapshot.snapshot.entries.find((entry) => entry.name === "partial");
    const intoPartial = await performAndRead(
      page,
      () => page.locator(`#entries li[data-entry-id=${JSON.stringify(partialAt2.entryId)}] button.entry-open`).click(),
    );
    assert.equal(intoPartial.snapshot.snapshot.generation, 3);
    const projection = intoPartial.snapshot.snapshot.destinationProjection;
    assert.equal(projection.state, "current");
    assert.equal(projection.displayName, "dest-copy");
    assert.notEqual(projection.entryId, destinationAt2);
    const ok = intoPartial.snapshot.snapshot.entries.find((entry) => entry.name === "ok.bin");
    const unreadable = intoPartial.snapshot.snapshot.entries.find((entry) => entry.name === "unreadable.bin");

    const result = await withUnreadableEntry(
      path.join(root, "partial", "unreadable.bin"),
      path.join(root, "partial", "ok.bin"),
      async () => {
        await performAndRead(
          page,
          () => page.locator(`#entries li[data-entry-id=${JSON.stringify(ok.entryId)}] input.entry-select`).check(),
        );
        await performAndRead(
          page,
          () => page.locator(`#entries li[data-entry-id=${JSON.stringify(unreadable.entryId)}] input.entry-select`).check(),
        );
        return performAndRead(page, () => page.locator("#copy-entries").click());
      },
    );

    assert.equal(result.value.overallStatus, "partial");
    assert.deepEqual(result.value.outcomes.map((outcome) => outcome.status), ["accepted", "failed"]);
    assert.equal(result.value.snapshot.state, "current");
    assert.equal(existsSync(path.join(root, "dest-copy", "ok.bin")), true);
    assert.equal(existsSync(path.join(root, "dest-copy", "unreadable.bin")), false);
    assert.deepEqual(
      readFileSync(path.join(root, "dest-copy", "ok.bin")),
      readFileSync(path.join(root, "partial", "ok.bin")),
    );
  } finally {
    await harness.close();
  }
});
