import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chooseRoot, launchPackagedFixture } from "./support/packaged-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const rootNames = manifest.entries
  .filter((entry) => !entry.path.includes("/"))
  .map((entry) => entry.path)
  .sort((left, right) => left.localeCompare(right));

test("FM-SYS-RELAUNCH-RESELECT uses a new process and requires explicit root selection", async () => {
  const harness = await launchPackagedFixture(manifest);
  let second = null;
  try {
    const pidA = harness.electronApp.process().pid;
    assert.equal(Number.isSafeInteger(pidA), true);
    const selectedA = await chooseRoot(harness.page);
    assert.equal(selectedA.status, "accepted");
    assert.equal(selectedA.snapshot.generation, 1);

    const closedA = await harness.closeApplication();
    assert.equal(closedA.pid, pidA);
    assert.notEqual(closedA.exitCode, null);

    const { _electron } = await import("playwright");
    second = await _electron.launch({
      args: ["."],
      cwd: harness.app,
      env: { ...process.env, MSSP_FM_STUB_ROOT: harness.root },
    });
    const pidB = second.process().pid;
    assert.equal(Number.isSafeInteger(pidB), true);
    assert.notEqual(pidB, pidA);
    const page = await second.firstWindow();
    page.setDefaultTimeout(10_000);
    await page.waitForLoadState("domcontentloaded");

    assert.equal(await page.locator("#root-label").textContent(), "No root selected");
    assert.equal(await page.locator("#generation").textContent(), "-");
    assert.deepEqual(await page.locator("#entries li").evaluateAll((rows) => rows.length), 0);

    const selectedB = await chooseRoot(page);
    assert.equal(selectedB.status, "accepted");
    assert.equal(selectedB.snapshot.generation, 1);
    assert.deepEqual(
      selectedB.snapshot.entries.map((entry) => entry.name),
      rootNames,
    );
  } finally {
    if (second !== null) await second.close().catch(() => {});
    await harness.close();
  }
});
