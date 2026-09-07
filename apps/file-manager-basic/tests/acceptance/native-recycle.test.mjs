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
import {
  findExactRecycleItems,
  restoreExactRecycleItem,
} from "./support/recycle-bin-evidence.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

for (const scenario of [
  { id: "FM-TRASH-FILE", name: "trash-file.txt" },
  { id: "FM-TRASH-DIRECTORY", name: "trash-dir" },
]) {
  test(`${scenario.id} uses a recoverable native recycle operation`, async () => {
    const harness = await launchPackagedFixture(manifest);
    const source = path.join(harness.root, scenario.name);
    try {
      assert.deepEqual(findExactRecycleItems(source), []);
      await chooseRoot(harness.page);
      await selectEntry(harness.page, scenario.name);
      const result = await performAndRead(
        harness.page,
        () => harness.page.locator("#trash-entries").click(),
      );
      assert.equal(result.overallStatus, "accepted");
      assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["accepted"]);
      assert.equal(result.snapshot.state, "current");
      assert.equal(result.snapshot.snapshot.generation, 2);
      assert.equal(existsSync(source), false);

      const evidence = findExactRecycleItems(source);
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].name, scenario.name);
      assert.equal(path.basename(evidence[0].deletedFrom), path.basename(harness.root));
      assert.match(evidence[0].recycleLeaf, /^\$R/i);

      const restored = restoreExactRecycleItem(source);
      assert.deepEqual(restored, { restored: true, originalLeaf: scenario.name });
      assert.equal(existsSync(source), true);
      assert.equal(verifyTree(harness.root, manifest).status, "match");
    } finally {
      if (!existsSync(source)) {
        try { restoreExactRecycleItem(source); } catch {}
      }
      await harness.close();
    }
  });
}
