// A0 / packaged launch — the security boundary as the RENDERER actually experiences it.
//
//   node --test tests/packaged-window.test.mjs
//
// WHY THIS EXISTS, when security-boundary.test.mjs already passes.
//
// That suite asserts what `security.ts` RETURNS. Nothing in it connects those
// values to a real BrowserWindow. On 2026-08-24 `dist/main/main.js` did not
// exist at all and all nine of its tests were green — an application that
// cannot start scored a perfect security contract.
//
// So this file asks a different question, and it is the only question that
// matters for "packaged launch": with the real app running, does the RENDERER
// live inside the declared boundary? Every assertion below is evaluated INSIDE
// the page, by the page, and reported back out.
//
// The contract values are imported rather than restated, so the two suites
// cannot drift: this one measures the world, that one measures the declaration,
// and they are compared against the same object.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT_MAIN = path.join(app, "dist", "main", "main.js");
const BUILT_SECURITY = path.join(app, "dist", "main", "security.js");
const PREREG = path.join(app, "..", "..",
  "slices", "01-text-editor-basic", "preregistration.json");

let electronApp = null;
let page = null;
let launchFailure = null;

before(async () => {
  // Fail for the INTENDED reason, not for a harness problem. On 2026-08-22 a
  // runner misconfiguration produced a red run that said nothing about the
  // subject; naming the missing artifact keeps that from repeating.
  if (!existsSync(BUILT_MAIN)) {
    launchFailure = new Error(
      `dist/main/main.js does not exist — the app has no entry point.\n`
      + `  package.json declares "main": "dist/main/main.js".\n`
      + `  If this is the RED phase, that is the intended absence: the security\n`
      + `  contract is built (${existsSync(BUILT_SECURITY) ? "security.js present" : "security.js missing too"}) `
      + `but nothing constructs a window from it.`);
    return;
  }
  const { _electron } = await import("playwright");
  electronApp = await _electron.launch({ args: ["."], cwd: app });
  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

after(async () => {
  if (electronApp) await electronApp.close();
});

/** Every test needs a live window; report the launch failure once, clearly. */
function requireWindow() {
  if (launchFailure) assert.fail(launchFailure.message);
  assert.ok(page, "no renderer window was produced");
}

async function contract() {
  return import(pathToFileURL(BUILT_SECURITY).href);
}

test("the packaged app launches and produces exactly one window", async () => {
  requireWindow();
  const windows = electronApp.windows();
  assert.equal(windows.length, 1, `expected 1 window, got ${windows.length}`);
});

test("the renderer has no Node require", async () => {
  requireWindow();
  // Asked INSIDE the page. `windowOptions().nodeIntegration === false` is a
  // declaration; this is the observation.
  const hasRequire = await page.evaluate(() => typeof require !== "undefined");
  assert.equal(hasRequire, false, "require is reachable from the renderer");
});

test("the renderer has no Node process object", async () => {
  requireWindow();
  const hasProcess = await page.evaluate(() => typeof process !== "undefined");
  assert.equal(hasProcess, false, "process is reachable from the renderer");
});

test("the preload exposes exactly the declared surface, and nothing else", async () => {
  requireWindow();
  const { PRELOAD_API_SURFACE } = await contract();
  const exposed = await page.evaluate((names) => {
    const present = names.filter((n) => n in window);
    return { present, ipcRenderer: "ipcRenderer" in window };
  }, [...PRELOAD_API_SURFACE]);
  assert.deepEqual(exposed.present, [...PRELOAD_API_SURFACE],
    "the declared surface is not fully present on window");
  assert.equal(exposed.ipcRenderer, false, "raw ipcRenderer is on the renderer window");
});

test("the CSP the renderer received is the one the contract declares", async () => {
  requireWindow();
  const { contentSecurityPolicy } = await contract();
  // Read from the document, not from the module — this is what actually
  // governs the page.
  const applied = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return meta ? meta.getAttribute("content") : null;
  });
  assert.ok(applied, "no Content-Security-Policy is in effect on the loaded document");
  assert.equal(applied, contentSecurityPolicy(),
    "the applied CSP differs from the declared one");
});

test("the CSP is actually enforced against script the page itself introduces", async () => {
  requireWindow();
  // A declared CSP that is not enforced is a comment, so provoke it — but
  // provoke it from INSIDE the page's own script pipeline.
  //
  // The first version of this test called `eval()` through page.evaluate() and
  // failed while the CSP was correct. page.evaluate() reaches the renderer over
  // the DevTools protocol, and CDP evaluation is not subject to the document's
  // CSP: it was measuring Playwright's execution context, not the page's. The
  // instrument was not the subject.
  //
  // Injecting an inline <script> element goes through the document's normal
  // script pipeline, which `script-src 'self'` does govern. If it runs, the
  // policy is not in force.
  const inlineRan = await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__inlineRan = true;";
    document.head.appendChild(s);
    return window.__inlineRan === true;
  });
  assert.equal(inlineRan, false,
    "an inline <script> executed — the CSP is declared but not enforced");
});

test("navigation to a remote origin does not move the window", async () => {
  requireWindow();
  const before = page.url();
  await page.evaluate(() => {
    try { window.location.href = "https://example.com/"; } catch { /* refused */ }
  });
  await new Promise((r) => setTimeout(r, 400));
  const url = page.url();
  assert.equal(url, before, `the window navigated away: ${before} -> ${url}`);
  assert.ok(url.startsWith("file:"), `the window is not on a file: URL: ${url}`);
});

test("the running window's options match the preregistration", async () => {
  requireWindow();
  const declared = JSON.parse(readFileSync(PREREG, "utf8")).electron_security_boundary;
  // Read from the live BrowserWindow in the main process, not from the module.
  const actual = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences() ?? {};
    return {
      nodeIntegration: p.nodeIntegration === true,
      contextIsolation: p.contextIsolation !== false,
      sandbox: p.sandbox !== false,
    };
  });
  assert.equal(actual.nodeIntegration, declared.nodeIntegration);
  assert.equal(actual.contextIsolation, declared.contextIsolation);
  assert.equal(actual.sandbox, declared.renderer_sandbox);
});
