// A0 / file loop — the workflow steps A0 covers, driven through the GUI.
//
//   node --test tests/file-loop.test.mjs
//
// SCOPE. The preregistration's A0 is "file loop": packaged launch (delivered in
// 4b8cf3a), new/open/edit/Save As/save, the unsaved-change guard, manual
// reopen, and an external byte/EOL oracle. Undo/redo, clipboard and
// find/replace belong to A1 and are deliberately absent here.
//
// HOW IT DRIVES. `ui-shell`'s acceptance row reads: "every workflow step is
// driven through it; a step needing an internal call fails ui_complete". So
// every step below clicks a control or types into the document surface. None of
// them calls a preload function directly — doing so would prove the plumbing
// works while leaving the application unusable, which is the same mistake as
// nine green contract tests over an app with no entry point.
//
// DIALOGS ARE STUBBED, AND SAY SO. `dialog_coverage` allows the automated run
// to take pinned paths from the main process in test mode, on one condition:
// "the automated path may never be reported as native-dialog coverage". That
// condition is machine-checked here rather than promised — the app must mark
// itself `dialog_path=stubbed` in the DOM whenever a pinned path is in play,
// and a test asserts the mark is present. A run that forgot to mark itself
// would be indistinguishable from a native-dialog run in the report.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT_MAIN = path.join(app, "dist", "main", "main.js");
const SLICE = path.join(app, "..", "..", "slices", "01-text-editor-basic");
const PREREG = path.join(SLICE, "preregistration.json");
const FIXTURES = path.join(SLICE, "fixtures");

const prereg = JSON.parse(readFileSync(PREREG, "utf8"));
const fixture = (key) => path.join(FIXTURES, prereg.fixtures[key].file);

let electronApp = null;
let page = null;
let scratch = null;
let launchFailure = null;

before(async () => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "a0-fileloop-"));
  if (!existsSync(BUILT_MAIN)) {
    launchFailure = new Error("dist/main/main.js does not exist — run npm run build");
    return;
  }
  const { _electron } = await import("playwright");
  electronApp = await _electron.launch({
    args: ["."],
    cwd: app,
    // Test mode: the main process answers Open/Save As with these pinned paths
    // instead of showing a native dialog, and must mark the run stubbed.
    env: { ...process.env, TEXT_EDITOR_TEST_MODE: "1", TEXT_EDITOR_SCRATCH: scratch },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

after(async () => {
  // Teardown must not depend on the subject behaving — that is the only case
  // where teardown matters. See the block below for what asking nicely cost.
  if (electronApp) {
    const pid = (() => { try { return electronApp.process().pid; } catch { return null; } })();

    // Kill the tree FIRST. Do not ask nicely.
    //
    // `electronApp.close()` requests a quit, and the unsaved-change guard is
    // entitled to refuse — under a mutation that welds it shut it refuses
    // forever. Bounding that close still left the app alive behind the bound,
    // and the drill then hung on the survivors. A teardown that depends on the
    // subject cooperating cannot clean up after the subject misbehaving, which
    // is the only case where cleanup matters.
    //
    // `/T` is the point: on Windows, killing the parent leaves the renderer,
    // GPU and utility children running. Scoped to a pid THIS suite spawned —
    // never a name or path pattern, which is how 16 unrelated Electron
    // processes were killed earlier today.
    if (pid && process.platform === "win32") {
      const { spawnSync } = await import("node:child_process");
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 15_000 });
    }
    try { electronApp.process().kill("SIGKILL"); } catch { /* already gone */ }
  }
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function ready() {
  if (launchFailure) assert.fail(launchFailure.message);
  assert.ok(page, "no renderer window");
}

/** Every control the workflow needs. Absent ones fail by name, not by timeout. */
async function control(id) {
  ready();
  const el = page.locator(`#${id}`);
  const count = await el.count();
  assert.equal(count, 1,
    `no GUI control #${id} — the workflow step cannot be driven through the shell.\n`
    + `  ui-shell's acceptance row fails a step that needs an internal call.`);
  return el;
}

/** Tell main which path the next stubbed dialog should return. */
async function pinDialogPath(p) {
  await electronApp.evaluate(async ({ ipcMain }, target) => {
    globalThis.__testDialogPath = target;
    void ipcMain;
  }, p);
}

test("the document surface exists and starts empty", async () => {
  const doc = await control("document");
  assert.equal(await doc.inputValue(), "", "a new document is not empty");
});

test("step 2 — a new document accepts typing and reports itself modified", async () => {
  const doc = await control("document");
  await doc.fill("hello from A0\n");
  const dirty = await page.locator("#dirty").getAttribute("data-dirty");
  assert.equal(dirty, "true", "typing did not mark the document modified");
});

test("step 3 — Save As writes the typed text to a new path", async () => {
  const target = path.join(scratch, "saved-as.txt");
  await pinDialogPath(target);
  await (await control("save-as")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  assert.ok(existsSync(target), `Save As did not create ${target}`);
  assert.equal(readFileSync(target, "utf8"), "hello from A0\n");
});

test("a new document uses LF, per encoding_policy", async () => {
  const target = path.join(scratch, "saved-as.txt");
  const bytes = readFileSync(target);
  assert.ok(!bytes.includes(Buffer.from("\r\n")), "a new document was written with CRLF");
});

test("the run marks itself dialog_path=stubbed", async () => {
  // The one rule dialog_coverage attaches to automated runs. Checked, not promised.
  //
  // Goes through control() rather than a bare locator: a bare getAttribute on a
  // missing element waits out the full 30s timeout and then reports null, so
  // "the app has no status region" and "the app forgot the mark" arrived as the
  // same slow failure. Distinct causes should not share one verdict.
  const status = await control("status");
  const mark = await status.getAttribute("data-dialog-path");
  assert.equal(mark, "stubbed",
    "the automated run is not marked stubbed — its report would be "
    + "indistinguishable from real native-dialog coverage");
});

test("step 5 — Open loads a pinned UTF-8 fixture exactly", async () => {
  await pinDialogPath(fixture("small_lf"));
  await (await control("open")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  const shown = await (await control("document")).inputValue();
  const onDisk = readFileSync(fixture("small_lf"), "utf8");
  assert.equal(shown, onDisk, "the opened document differs from the bytes on disk");
});

test("step 9 — Save preserves the file's existing CRLF line endings", async () => {
  const target = path.join(scratch, "roundtrip-crlf.txt");
  const original = readFileSync(fixture("small_crlf"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(target, original);

  await pinDialogPath(target);
  await (await control("open")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  await (await control("document")).fill("edited\r\nsecond line\r\n".replace(/\r/g, ""));
  await (await control("save")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");

  const written = readFileSync(target);
  assert.ok(written.includes(Buffer.from("\r\n")),
    "the file's CRLF endings were not preserved on save");
  assert.ok(!/(?<!\r)\n/.test(written.toString("utf8")),
    "the saved file mixes bare LF into a CRLF document");
});

test("a UTF-8 BOM present on read is preserved on write", async () => {
  const target = path.join(scratch, "roundtrip-bom.txt");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(target, readFileSync(fixture("small_bom")));

  await pinDialogPath(target);
  await (await control("open")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  await (await control("save")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");

  const written = readFileSync(target);
  assert.deepEqual([...written.subarray(0, 3)], [0xEF, 0xBB, 0xBF],
    "the UTF-8 BOM was dropped on save");
});

test("error-report — a non-UTF-8 file is refused BY NAME and the name reaches the GUI", async () => {
  await pinDialogPath(fixture("invalid_not_utf8"));
  await (await control("open")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  const message = await page.locator("#error").textContent();
  assert.ok(message && message.trim().length > 0, "no error was shown to the user");
  assert.ok(message.includes(path.basename(fixture("invalid_not_utf8"))),
    `the refusal does not name the file: ${message}`);
  assert.doesNotMatch(message, /guess|assume|fallback/i,
    "the refusal suggests guessing an encoding, which encoding_policy forbids");
});

test("unsaved-change-guard REFUSES a close while the document is modified", async () => {
  const doc = await control("document");
  await doc.fill("unsaved edit");
  // Wait for the flag main actually guards on, not for the attribute alone.
  // `data-dirty` is now set from main's reply, so this waits for the round trip.
  await page.waitForFunction(() =>
    document.getElementById("dirty")?.dataset.dirty === "true");

  const blocked = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.close();                       // a route the acceptance does not drive
    await new Promise((r) => setTimeout(r, 300));
    return !w.isDestroyed();
  });
  assert.equal(blocked, true, "the window closed with unsaved changes");
});

test("unsaved-change-guard PERMITS a close once the document is saved", async () => {
  // The positive case, and it has to be a real close.
  //
  // A guard that always refuses passes every "it blocks the bad thing" test
  // while making the application impossible to quit, so refusing is only half
  // the evidence. The first version of this test asked whether the renderer
  // could still evaluate `true` — which is a liveness check wearing a guard
  // test's name, and would have stayed green against a guard welded shut.
  const target = path.join(scratch, "guard-release.txt");
  await pinDialogPath(target);
  await (await control("save-as")).click();
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
  await page.waitForFunction(() =>
    document.getElementById("dirty")?.dataset.dirty === "false");

  // Observe from OUTSIDE the process that is about to exit.
  //
  // The first version asked the main process to close the window and then
  // report `isDestroyed()`. Closing the last window quits the app, so the
  // evaluation context died before it could answer and the test failed with
  // "Execution context was destroyed" — a success that destroyed the instrument
  // meant to observe it. Schedule the close, return immediately, then watch the
  // window list from the driver's side, where nothing is being torn down.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    setTimeout(() => w.close(), 0);
  }).catch(() => { /* the app may already be on its way out */ });

  let closed = false;
  for (let i = 0; i < 25 && !closed; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    try { closed = electronApp.windows().length === 0; } catch { closed = true; }
  }
  assert.equal(closed, true, "a saved document could not be closed — the guard never releases");
  page = null;                       // the window is gone; nothing may use it after this
});
