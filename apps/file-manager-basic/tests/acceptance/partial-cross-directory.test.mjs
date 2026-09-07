import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { launchPackagedFixture, chooseRoot, performAndRead } from "./support/packaged-harness.mjs";
import { withUnreadableEntry } from "./support/dynamic-subjects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("FM-COPY-PARTIAL can address nested sources and the root destination in one batch", async () => {
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

    const result = await withUnreadableEntry(
      path.join(root, "partial", "unreadable.bin"),
      path.join(root, "partial", "ok.bin"),
      () => page.evaluate(
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
      ),
    );

    assert.ok(optionValues.includes(destinationId),
      `root destination is not expressible in the nested source snapshot GUI; result=${JSON.stringify(result.value)}`);
    assert.equal(result.value.overallStatus, "partial");
    assert.deepEqual(result.value.outcomes.map((outcome) => outcome.status), ["accepted", "failed"]);
  } finally {
    await harness.close();
  }
});
