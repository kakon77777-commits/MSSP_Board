import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

test("accepted copy with unavailable post-scan renders the snapshot code", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "app2-postscan-author-"));
  let electronApp;
  try {
    await fs.mkdir(path.join(root, "dest"));
    await fs.writeFile(path.join(root, "ok.bin"), Buffer.from("ok"));
    const { _electron } = await import("playwright");
    electronApp = await _electron.launch({
      args: ["."], cwd: app,
      env: { ...process.env, MSSP_FM_STUB_ROOT: root, MSSP_FM_FAIL_SCAN_AT: "3" },
    });
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(5_000);
    await page.locator("#choose-root").click();
    await page.waitForFunction(() => document.querySelector("#generation")?.textContent === "1");
    await page.locator("#pin-target").selectOption({ label: "dest" });
    await page.locator("#set-destination").click();
    await page.waitForFunction(() => document.querySelector("#generation")?.textContent === "2");
    await page.locator('#entries li[data-name="ok.bin"] input.entry-select').check();
    await page.locator("#destination").selectOption({ label: "dest (pinned)" });
    await page.locator("#copy-entries").click();
    await page.waitForFunction(() => document.querySelector("#snapshot-status")?.textContent === "unavailable");
    const result = await page.evaluate(() => window.__lastFileManagerResult);
    assert.equal(result.overallStatus, "accepted");
    assert.equal(result.outcomes[0].status, "accepted");
    assert.equal(result.snapshot.code, "snapshot_read_failed");
    assert.equal(await page.locator("#error-code").textContent(), "snapshot_read_failed");
    assert.deepEqual(await fs.readFile(path.join(root, "dest", "ok.bin")), Buffer.from("ok"));
  } finally {
    if (electronApp) await electronApp.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
