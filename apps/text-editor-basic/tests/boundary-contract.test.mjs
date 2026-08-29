// A2 / boundary contract — the result union and the encoding row, through the GUI.
//
//   node --test tests/boundary-contract.test.mjs
//
// WHY THIS FILE EXISTS. The A0/A1 suite drives the packaged app and asserts on
// what the window shows. It never reads the shape of what main returns, so it
// stayed green through a complete rewrite of that shape — 62/62 both before and
// after. That is not the suite being wrong; it is measuring a different claim.
// The union, the typed refusal, the unchanged-boundary evidence and the
// generation counter were, until this file, asserted by nothing.
//
// WHAT IT ASSERTS. Core 4.1 and 4.2: every operation returns accepted /
// cancelled / refused; cancelled and refused carry the boundary UNCHANGED and do
// not advance `boundaryGeneration`; an accepted operation advances it exactly
// once; the renderer asks for the initial snapshot rather than deriving a format.
//
// HOW IT DRIVES. Through the GUI, like the A0 suite, because a boundary that
// only works when called directly is a boundary the user never reaches. The
// encoding row is read from the DOM, which is the only place the projection
// writes — asserting on the IPC reply instead would test main and the renderer
// separately and the seam between them not at all.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
  scratch = mkdtempSync(path.join(os.tmpdir(), "a2-boundary-"));
  if (!existsSync(BUILT_MAIN)) {
    launchFailure = new Error("dist/main/main.js does not exist — run npm run build");
    return;
  }
  const { _electron } = await import("playwright");
  electronApp = await _electron.launch({
    args: ["."],
    cwd: app,
    env: { ...process.env, TEXT_EDITOR_TEST_MODE: "1", TEXT_EDITOR_SCRATCH: scratch },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

after(async () => {
  // Kill the tree first and scoped to a pid this suite spawned. Asking the app
  // to quit depends on the app behaving, which is the one case where teardown
  // matters; a name pattern once killed 16 unrelated Electron processes.
  if (electronApp) {
    const pid = (() => { try { return electronApp.process().pid; } catch { return null; } })();
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

async function pinDialogPath(target) {
  await electronApp.evaluate(async ({ ipcMain }, value) => {
    globalThis.__testDialogPath = value;
    void ipcMain;
  }, target);
}

async function settle() {
  await page.waitForFunction(() =>
    document.getElementById("status")?.dataset.busy !== "true");
}

async function click(id) {
  ready();
  const control = page.locator(`#${id}`);
  assert.equal(await control.count(), 1, `#${id} is missing from the window`);
  await control.click();
  await settle();
}

/** The whole encoding row as the user sees it, in one read. */
async function row() {
  ready();
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent ?? null;
    return {
      encoding: text("encoding"),
      bom: text("bom"),
      eol: text("eol"),
      bytes: text("bytes"),
      name: text("name"),
      generation: text("generation"),
      error: text("error"),
      dirty: document.getElementById("dirty")?.getAttribute("data-dirty") ?? null,
    };
  });
}

const generationOf = (state) => Number.parseInt(state.generation ?? "", 10);

test("the initial handshake fills the encoding row before any file operation", async () => {
  const state = await row();
  // "-" is the null state and would also be what a renderer that never asked
  // shows, so the two are distinguished here rather than assumed apart.
  assert.equal(state.encoding, "utf-8", "the row is still in its null state; main was never asked");
  assert.equal(state.bom, "No BOM");
  assert.equal(state.eol, "LF");
  assert.equal(state.name, "untitled");
  assert.equal(state.bytes, "-", "a document never read from disk has no measured byte length");
  assert.ok(Number.isInteger(generationOf(state)), `generation is ${state.generation}`);
});

test("opening a BOM+CRLF file shows the format the codec measured", async () => {
  const target = fixture("small_bom");
  const before = generationOf(await row());
  await pinDialogPath(target);
  await click("open");
  const state = await row();
  assert.equal(state.bom, "BOM");
  assert.equal(state.name, path.basename(target));
  assert.equal(state.bytes, String(statSync(target).size),
    "the byte count the codec measured did not reach the window");
  assert.equal(generationOf(state), before + 1, "an accepted Open advances the generation once");
  assert.equal(state.error, "", "a successful open left an error on screen");
});

test("Save As publishes the NEW identity, not the one held a moment ago", async () => {
  const target = path.join(scratch, "saved-as.txt");
  const before = await row();
  await pinDialogPath(target);
  await click("save-as");
  const state = await row();
  // This is the exact defect the packaged replay found: the boundary was built
  // before `current` was updated, so a successful Save As reported the previous
  // file's name and generation while the bytes were already on disk under the
  // new one.
  assert.ok(existsSync(target), "Save As did not write the file");
  assert.equal(state.name, path.basename(target),
    "the window still names the file that was open before the save");
  assert.equal(generationOf(state), generationOf(before) + 1,
    "an accepted Save As advances the generation exactly once");
});

test("a refused open names the file and leaves the boundary exactly where it was", async () => {
  const before = await row();
  await pinDialogPath(fixture("invalid_not_utf8"));
  await click("open");
  const state = await row();
  assert.match(state.error ?? "", /invalid-not-utf8\.bin/,
    "the refusal did not reach the GUI carrying the file's name");
  // The unchanged boundary is the evidence. Without it a refusal is only the
  // absence of a change, which looks identical to a change nobody rendered.
  assert.equal(generationOf(state), generationOf(before),
    "a refused operation advanced the generation");
  assert.equal(state.name, before.name, "a refused open changed the document name");
  assert.equal(state.bom, before.bom);
  assert.equal(state.eol, before.eol);
  assert.equal(state.bytes, before.bytes);
  assert.equal(state.dirty, before.dirty);
});

test("a cancelled operation is not a refusal: no error, and nothing moved", async () => {
  const before = await row();
  // A null pinned path is how test mode expresses "the user dismissed the dialog".
  await pinDialogPath(null);
  await click("open");
  const state = await row();
  assert.equal(state.error, "", "a cancelled operation reported an error");
  assert.equal(generationOf(state), generationOf(before),
    "a cancelled operation advanced the generation");
  assert.equal(state.name, before.name);
  assert.equal(state.bytes, before.bytes);
});

test("the previous refusal does not persist once an operation succeeds", async () => {
  await pinDialogPath(fixture("invalid_not_utf8"));
  await click("open");
  assert.notEqual((await row()).error, "", "the refusal never appeared, so its clearing is untested");
  await pinDialogPath(fixture("small_lf"));
  await click("open");
  const state = await row();
  assert.equal(state.error, "", "a stale refusal survived a successful open");
  assert.equal(state.eol, "LF");
  assert.equal(state.bom, "No BOM");
});
