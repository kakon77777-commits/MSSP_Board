import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  installIpcCapture,
  launchPackagedFixture,
  performAndRead,
  readIpcCapture,
  selectEntry,
} from "./support/packaged-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

test("FM-SYS-PATH-AUTHORITY captures only operation DTOs across the renderer boundary", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root, electronApp } = harness;
  try {
    await installIpcCapture(electronApp);
    await chooseRoot(page);
    await selectEntry(page, "copy-file.bin");
    await performAndRead(
      page,
      () => page.locator('#entries li[data-name="nav"] button.entry-open').click(),
    );
    await performAndRead(page, () => page.locator("#navigate-parent").click());
    await page.locator("#name-input").fill("created-folder");
    await performAndRead(page, () => page.locator("#create-directory").click());

    const captured = await readIpcCapture(electronApp);
    assert.deepEqual(captured.map((entry) => entry.channel), [
      "file-manager:choose-root",
      "file-manager:set-selection",
      "file-manager:navigate",
      "file-manager:navigate",
      "file-manager:create-directory",
    ]);
    assert.deepEqual(captured[0].args, []);

    const selection = captured[1].args[0];
    exactKeys(selection, ["generation", "items"]);
    exactKeys(selection.items[0], ["ordinal", "submittedEntryId"]);
    assert.equal(selection.generation, 1);
    assert.equal(typeof selection.items[0].submittedEntryId, "string");

    for (const navigation of captured.slice(2, 4).map((entry) => entry.args[0])) {
      exactKeys(navigation, ["generation", "entryId"]);
      assert.equal(Number.isSafeInteger(navigation.generation), true);
      assert.equal(navigation.entryId === null || typeof navigation.entryId === "string", true);
    }

    const create = captured[4].args[0];
    exactKeys(create, ["generation", "name", "parentEntryId"]);
    assert.equal(create.name, "created-folder");
    assert.equal(create.parentEntryId, null);

    const serialized = JSON.stringify(captured);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes(root.replaceAll("\\", "/")), false);
    assert.doesNotMatch(serialized, /(?:[A-Za-z]:[\\/]|file:\/\/|\\\\)/);
  } finally {
    await harness.close();
  }
});
