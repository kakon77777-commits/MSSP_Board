import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  launchPackagedFixture,
  performAndRead,
  selectEntry,
} from "./support/packaged-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("FM-SYS-SNAPSHOT-UNAVAILABLE reports a real copy whose immediately following scan failed", async () => {
  const harness = await launchPackagedFixture(manifest, { failScanAt: 4 });
  const { page, root } = harness;
  const target = path.join(root, "dest-copy", "ok.bin");
  try {
    await chooseRoot(page);
    await page.locator("#pin-target").selectOption({ label: "dest-copy" });
    const pinned = await performAndRead(page, () => page.locator("#set-destination").click());
    assert.equal(pinned.snapshot.snapshot.generation, 2);
    const partial = pinned.snapshot.snapshot.entries.find((entry) => entry.name === "partial");
    const nested = await performAndRead(
      page,
      () => page.locator(`#entries li[data-entry-id=${JSON.stringify(partial.entryId)}] button.entry-open`).click(),
    );
    assert.equal(nested.snapshot.snapshot.generation, 3);
    assert.equal(existsSync(target), false);

    await selectEntry(page, "ok.bin");
    const result = await performAndRead(page, () => page.locator("#copy-entries").click());
    assert.equal(result.overallStatus, "accepted");
    assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["accepted"]);
    assert.equal(result.snapshot.state, "unavailable");
    assert.equal(result.snapshot.snapshot, null);
    assert.equal(result.snapshot.lastPublishedGeneration, 3);
    assert.equal(result.snapshot.code, "snapshot_read_failed");
    assert.equal(await page.locator("#snapshot-status").textContent(), "unavailable");
    assert.equal(await page.locator("#error-code").textContent(), "snapshot_read_failed");
    assert.equal(existsSync(target), true);
    assert.deepEqual(readFileSync(target), readFileSync(path.join(root, "partial", "ok.bin")));

    unlinkSync(target);
    const recovered = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(recovered.status, "accepted");
    assert.equal(recovered.snapshot.state, "current");
    assert.equal(recovered.snapshot.snapshot.generation, 4);
    assert.equal(existsSync(target), false);
  } finally {
    if (existsSync(target)) unlinkSync(target);
    await harness.close();
  }
});
