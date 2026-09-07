import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { launchPackagedFixture, chooseRoot, performAndRead } from "./support/packaged-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("an old cross-snapshot destination ID cannot bypass the pinned-destination route", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    const selected = await chooseRoot(page);
    const destinationId = selected.snapshot.entries.find((entry) => entry.name === "dest-copy").entryId;
    const intoPartial = await performAndRead(
      page,
      () => page.locator('#entries li[data-name="partial"] button.entry-open').click(),
    );
    const snapshot = intoPartial.snapshot.snapshot;
    const okId = snapshot.entries.find((entry) => entry.name === "ok.bin").entryId;
    const unreadableId = snapshot.entries.find((entry) => entry.name === "unreadable.bin").entryId;
    const optionValues = await page.locator("#destination option").evaluateAll(
      (options) => options.map((option) => option.value),
    );

    const result = await page.evaluate(
      ({ generation, items, destination }) =>
        window.fileManager.copyEntries(generation, items, destination),
      {
        generation: snapshot.generation,
        items: [
          { ordinal: 0, submittedEntryId: okId },
          { ordinal: 1, submittedEntryId: unreadableId },
        ],
        destination: destinationId,
      },
    );

    assert.equal(optionValues.includes(destinationId), false);
    assert.equal(result.overallStatus, "refused");
    assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["refused", "refused"]);
    assert.deepEqual(result.outcomes.map((outcome) => outcome.code), ["invalid_entry_id", "invalid_entry_id"]);
    assert.equal(result.snapshot.state, "unchanged");
    assert.equal(result.snapshot.snapshot.generation, 2);
    assert.equal(existsSync(path.join(root, "dest-copy", "ok.bin")), false);
    assert.equal(existsSync(path.join(root, "dest-copy", "unreadable.bin")), false);
    assert.deepEqual(readFileSync(path.join(root, "partial", "ok.bin")), Buffer.from("deadbeef00112233", "hex"));
    assert.deepEqual(readFileSync(path.join(root, "partial", "unreadable.bin")), Buffer.from("1122334455667788", "hex"));
  } finally {
    await harness.close();
  }
});
