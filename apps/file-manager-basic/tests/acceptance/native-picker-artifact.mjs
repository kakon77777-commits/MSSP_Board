import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { materializeFixture } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-native-picker-";
const root = mkdtempSync(scratchPrefix);
materializeFixture(root, manifest);

let electronApp = null;
try {
  const { _electron } = await import("playwright");
  electronApp = await _electron.launch({ args: ["."], cwd: app, env: { ...process.env } });
  const page = await electronApp.firstWindow();
  page.setDefaultTimeout(120_000);
  await page.waitForLoadState("domcontentloaded");
  const pid = electronApp.process().pid;

  await page.evaluate(() => { window.__lastFileManagerResult = undefined; });
  await page.locator("#choose-root").click();
  process.stdout.write(`${JSON.stringify({ state: "cancel_dialog_open", root, pid })}\n`);
  await page.waitForFunction(() => window.__lastFileManagerResult !== undefined);
  const cancelled = await page.evaluate(() => window.__lastFileManagerResult);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.prior, null);
  assert.equal(cancelled.evidencePath, "native");
  process.stdout.write(`${JSON.stringify({ state: "cancel_verified", result: cancelled })}\n`);

  await page.evaluate(() => { window.__lastFileManagerResult = undefined; });
  await page.locator("#choose-root").click();
  process.stdout.write(`${JSON.stringify({ state: "selection_dialog_open", root, pid })}\n`);
  await page.waitForFunction(() => window.__lastFileManagerResult !== undefined);
  const selected = await page.evaluate(() => window.__lastFileManagerResult);
  assert.equal(selected.status, "accepted");
  assert.equal(selected.evidencePath, "native");
  assert.equal(selected.snapshot.generation, 1);
  assert.equal(selected.snapshot.root.displayName, path.basename(root));
  assert.deepEqual(
    selected.snapshot.entries.map((entry) => entry.name),
    manifest.entries.filter((entry) => !entry.path.includes("/")).map((entry) => entry.path)
      .sort((left, right) => left.localeCompare(right)),
  );
  assert.equal((await page.locator("body").textContent()).includes(root), false);
  assert.equal(verifyTree(root, manifest).status, "match");
  process.stdout.write(`${JSON.stringify({
    state: "native_picker_verified",
    pid,
    rootDisplayName: selected.snapshot.root.displayName,
    generation: selected.snapshot.generation,
    entryCount: selected.snapshot.entries.length,
    evidencePath: selected.evidencePath,
    manifestStatus: "match",
  })}\n`);
} finally {
  if (electronApp !== null) await electronApp.close().catch(() => {});
  const resolved = path.resolve(root).replaceAll("\\", "/");
  if (!resolved.startsWith(scratchPrefix)) throw new Error("refusing unsafe native-picker cleanup");
  rmSync(root, { recursive: true, force: true });
}
