// A0 / unsaved-change-guard — executable acceptance cases.
//
// Each case launches its own real Electron window and drives only visible GUI
// controls. The main-process evaluate calls are limited to the preregistered
// dialog-path stub and to observing/initiating a window close, which is the
// attack route the happy workflow does not drive.
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT_MAIN = path.join(app, "dist", "main", "main.js");
const PREREG = path.join(app, "..", "..", "slices", "01-text-editor-basic",
  "preregistration.json");
const FIXTURES = path.join(app, "..", "..", "slices", "01-text-editor-basic", "fixtures");

const CASES = Object.freeze([
  "A0-GUARD-CLEAN-NEW-ALLOWED",
  "A0-GUARD-CLEAN-OPEN-ALLOWED",
  "A0-GUARD-DIRTY-NEW-BLOCKED",
  "A0-GUARD-DIRTY-OPEN-BLOCKED",
  "A0-GUARD-DIRTY-CLOSE-BLOCKED",
  "A0-GUARD-FAILED-SAVE-STAYS-DIRTY",
  "A0-GUARD-SAVED-CLOSE-ALLOWED",
]);

test("guard case IDs bind to the existing fixed denominator", () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, "utf8"));
  const denominator = [
    ...prereg.required_capabilities.generic_infra,
    ...prereg.required_capabilities.domain,
  ];
  assert.equal(denominator.length, 11,
    "implementation order changed the preregistered denominator");
  assert.ok(denominator.includes("unsaved-change-guard"));
  assert.equal(typeof prereg.capability_acceptance_map["unsaved-change-guard"], "string");
  assert.equal(new Set(CASES).size, CASES.length, "guard acceptance case IDs are not unique");
});

async function withApp(body) {
  assert.ok(fs.existsSync(BUILT_MAIN), "dist/main/main.js is missing — run npm run build");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "a0-guard-"));
  const profile = path.join(scratch, "profile");
  const { _electron } = await import("playwright");
  let electronApp;
  let page;
  let mainProcess;

  try {
    electronApp = await _electron.launch({
      args: [".", `--user-data-dir=${profile}`],
      cwd: app,
      env: { ...process.env, TEXT_EDITOR_TEST_MODE: "1", TEXT_EDITOR_SCRATCH: scratch },
    });
    mainProcess = electronApp.process();
    assert.ok(mainProcess.spawnargs.some((arg) => String(arg).includes(profile)),
      "the launched process is not bound to this test's unique profile marker");
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await body({ electronApp, page, scratch });
  } finally {
    // First make the subject clean through its GUI, so ordinary teardown does
    // not need a bypass around the guard being tested.
    if (page && !page.isClosed()) {
      try {
        const dirty = await page.locator("#dirty").getAttribute("data-dirty");
        if (dirty === "true") {
          await pinDialogPath(electronApp, path.join(scratch, "teardown-save.txt"));
          await (await control(page, "save-as")).click();
          await waitIdle(page);
        }
      } catch { /* a failed assertion must not suppress bounded cleanup */ }
    }

    if (electronApp) {
      let closed = false;
      try {
        closed = await Promise.race([
          electronApp.close().then(() => true).catch(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
        ]);
      } catch { closed = true; }

      if (!closed && mainProcess && Number.isInteger(mainProcess.pid) && mainProcess.pid > 0) {
        // Exact process we launched, plus its children. Never an image name,
        // product-name match, repo-name match, or host-wide process filter.
        const killed = spawnSync("taskkill", ["/PID", String(mainProcess.pid), "/T", "/F"], {
          encoding: "utf8",
          timeout: 10_000,
        });
        assert.ok(killed.status === 0 || mainProcess.exitCode !== null,
          `exact process-tree cleanup failed for PID ${mainProcess.pid}: ${killed.stderr}`);
      }
    }

    assert.match(path.basename(scratch), /^a0-guard-/,
      "refusing to remove a directory not created by this test");
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function control(page, id) {
  const target = page.locator(`#${id}`);
  assert.equal(await target.count(), 1, `GUI control #${id} is unavailable`);
  return target;
}

async function pinDialogPath(electronApp, target) {
  await electronApp.evaluate(async ({ ipcMain }, pinned) => {
    globalThis.__testDialogPath = pinned;
    void ipcMain;
  }, target);
}

async function waitIdle(page) {
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
}

async function dirty(page, text) {
  await (await control(page, "document")).fill(text);
  await page.waitForFunction(() =>
    document.getElementById("dirty")?.dataset.dirty === "true");
}

async function closeFromMain(electronApp) {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return !window.isDestroyed();
  });
}

test(`${CASES[0]} clean New remains usable`, async () => {
  await withApp(async ({ page }) => {
    await (await control(page, "new")).click();
    await waitIdle(page);
    assert.equal(await (await control(page, "document")).inputValue(), "");
    assert.equal(await page.locator("#dirty").getAttribute("data-dirty"), "false");
  });
});

test(`${CASES[1]} clean Open remains usable`, async () => {
  await withApp(async ({ electronApp, page }) => {
    const prereg = JSON.parse(fs.readFileSync(PREREG, "utf8"));
    const fixture = path.join(FIXTURES, prereg.fixtures.small_lf.file);
    await pinDialogPath(electronApp, fixture);
    await (await control(page, "open")).click();
    await waitIdle(page);
    assert.equal(await (await control(page, "document")).inputValue(), fs.readFileSync(fixture, "utf8"));
  });
});

test(`${CASES[2]} dirty New cannot silently discard the document`, async () => {
  await withApp(async ({ page }) => {
    const text = "keep this dirty New content";
    await dirty(page, text);
    await (await control(page, "new")).click();
    await waitIdle(page);
    assert.equal(await (await control(page, "document")).inputValue(), text,
      "New silently discarded unsaved content");
    assert.equal(await page.locator("#dirty").getAttribute("data-dirty"), "true");
  });
});

test(`${CASES[3]} dirty Open cannot silently replace the document`, async () => {
  await withApp(async ({ electronApp, page }) => {
    const text = "keep this dirty Open content";
    const prereg = JSON.parse(fs.readFileSync(PREREG, "utf8"));
    const fixture = path.join(FIXTURES, prereg.fixtures.small_lf.file);
    await dirty(page, text);
    await pinDialogPath(electronApp, fixture);
    await (await control(page, "open")).click();
    await waitIdle(page);
    assert.equal(await (await control(page, "document")).inputValue(), text,
      "Open silently replaced unsaved content");
    assert.equal(await page.locator("#dirty").getAttribute("data-dirty"), "true");
  });
});

test(`${CASES[4]} blocked close preserves the exact visible content`, async () => {
  await withApp(async ({ electronApp, page }) => {
    const text = "close must not erase this";
    await dirty(page, text);
    assert.equal(await closeFromMain(electronApp), true, "dirty close was not refused");
    assert.equal(await (await control(page, "document")).inputValue(), text,
      "refusing close changed the unsaved content");
  });
});

test(`${CASES[5]} failed Save As remains dirty and guarded`, async () => {
  await withApp(async ({ electronApp, page, scratch }) => {
    await dirty(page, "save failure must stay dirty");
    await pinDialogPath(electronApp, scratch); // an existing directory cannot be the output file
    await (await control(page, "save-as")).click();
    await waitIdle(page);
    assert.equal(await page.locator("#dirty").getAttribute("data-dirty"), "true",
      "a failed save cleared the dirty state");
    assert.ok((await page.locator("#error").textContent())?.trim(),
      "the failed save did not reach the GUI");
    assert.equal(await closeFromMain(electronApp), true,
      "the guard released after a failed save");
  });
});

test(`${CASES[6]} a successfully saved document can close`, async () => {
  await withApp(async ({ electronApp, page, scratch }) => {
    await dirty(page, "saved content may close\n");
    await pinDialogPath(electronApp, path.join(scratch, "saved-clean.txt"));
    await (await control(page, "save-as")).click();
    await waitIdle(page);
    assert.equal(await page.locator("#dirty").getAttribute("data-dirty"), "false");

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      setTimeout(() => window.close(), 0);
    }).catch(() => {});

    let closed = false;
    for (let attempt = 0; attempt < 25 && !closed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try { closed = electronApp.windows().length === 0; } catch { closed = true; }
    }
    assert.equal(closed, true, "an always-block guard refused a clean close");
  });
});
