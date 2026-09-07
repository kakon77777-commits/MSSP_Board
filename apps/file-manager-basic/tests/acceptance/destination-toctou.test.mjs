import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  launchPackagedFixture,
  performAndRead,
  selectEntry,
} from "./support/packaged-harness.mjs";
import {
  finishDestinationSwapFault,
  installDestinationSwapFault,
} from "./support/destination-swap-fault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

for (const scenario of [
  { replacement: "file", expectedCode: "path_rejected" },
  { replacement: "junction", expectedCode: "reparse_refused" },
]) {
  test(`pinned destination changed to ${scenario.replacement} is distinctly refused at the I/O boundary`, async () => {
    const harness = await launchPackagedFixture(manifest);
    const runId = randomUUID();
    const destination = path.join(harness.root, "dest-copy");
    const backup = path.join(harness.root, `dest-copy.before-${runId}`);
    const outsideTarget = path.join("D:/Ai/work together", `.mssp-app2-destination-target-${runId}`);
    let fault = null;
    try {
      await chooseRoot(harness.page);
      await harness.page.locator("#pin-target").selectOption({ label: "dest-copy" });
      const pinned = await performAndRead(harness.page, () => harness.page.locator("#set-destination").click());
      assert.equal(pinned.snapshot.snapshot.generation, 2);
      await selectEntry(harness.page, "copy-file.bin");

      await installDestinationSwapFault(harness.electronApp, harness.app, {
        replacement: scenario.replacement,
        destination,
        backup,
        outsideTarget,
      });
      const result = await performAndRead(harness.page, () => harness.page.locator("#copy-entries").click());
      fault = await finishDestinationSwapFault(harness.electronApp);

      assert.equal(fault.count, 2);
      assert.equal(fault.swapped, true);
      assert.equal(result.overallStatus, "refused");
      assert.deepEqual(result.outcomes.map((outcome) => outcome.code), [scenario.expectedCode]);
      assert.equal(result.snapshot.state, "unchanged");
      assert.equal(result.snapshot.snapshot.generation, 2);
      assert.equal(existsSync(path.join(harness.root, "copy-file.bin")), true);
      assert.equal(existsSync(path.join(destination, "copy-file.bin")), false);
      if (scenario.replacement === "junction") assert.equal(existsSync(outsideTarget), true);
    } finally {
      if (fault === null) {
        try { fault = await finishDestinationSwapFault(harness.electronApp); } catch {}
      }
      if (existsSync(destination) && existsSync(backup)) {
        const replacement = lstatSync(destination);
        if (!replacement.isFile() && !replacement.isSymbolicLink()) {
          throw new Error("refusing to remove an unexpected destination replacement");
        }
        unlinkSync(destination);
      }
      if (existsSync(backup) && !existsSync(destination)) renameSync(backup, destination);
      if (existsSync(outsideTarget)) rmdirSync(outsideTarget);
      await harness.close();
    }
  });
}
