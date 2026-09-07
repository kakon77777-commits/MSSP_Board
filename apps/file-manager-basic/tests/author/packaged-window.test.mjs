import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const main = path.join(app, "dist", "main", "main.js");
const security = path.join(app, "dist", "main", "security.js");
let electronApp;
let page;
let launchError;

before(async () => {
  if (!existsSync(main)) {
    launchError = new Error("dist/main/main.js is absent; build before packaged-window test");
    return;
  }
  try {
    const { _electron } = await import("playwright");
    electronApp = await _electron.launch({ args: ["."], cwd: app });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  } catch (error) { launchError = error; }
});

after(async () => {
  if (electronApp) await electronApp.close();
});

function requireWindow() {
  if (launchError) assert.fail(`packaged launch failed: ${launchError.message}`);
  assert.ok(page && electronApp, "no packaged renderer window");
}

async function contract() {
  return import(`${pathToFileURL(security).href}?subject=${Date.now()}`);
}

test("packaged app produces one sandboxed window", async () => {
  requireWindow();
  assert.equal(electronApp.windows().length, 1);
  const globals = await page.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    ipcRenderer: "ipcRenderer" in window,
  }));
  assert.deepEqual(globals, { require: "undefined", process: "undefined", ipcRenderer: false });
});

test("live preload surface equals the declared closed surface", async () => {
  requireWindow();
  const { PRELOAD_API_SURFACE } = await contract();
  const live = await page.evaluate(() => Object.keys(window.fileManager ?? {}).sort());
  assert.deepEqual(live, [...PRELOAD_API_SURFACE].sort());
});

test("document receives and enforces the declared CSP", async () => {
  requireWindow();
  const { contentSecurityPolicy } = await contract();
  const observed = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const inline = document.createElement("script");
    inline.textContent = "window.__app2InlineRan = true";
    document.head.appendChild(inline);
    return { csp: meta?.getAttribute("content"), inlineRan: window.__app2InlineRan === true };
  });
  assert.equal(observed.csp, contentSecurityPolicy());
  assert.equal(observed.inlineRan, false);
});

test("the admitted stylesheet and renderer module actually arrive", async () => {
  requireWindow();
  const observed = await page.evaluate(() => ({
    styleSheets: document.styleSheets.length,
    toolbarDisplay: getComputedStyle(document.querySelector(".toolbar")).display,
    chooseRootIsWired: document.querySelector("#choose-root") instanceof HTMLButtonElement,
  }));
  assert.equal(observed.styleSheets, 1);
  assert.equal(observed.toolbarDisplay, "flex");
  assert.equal(observed.chooseRootIsWired, true);
});

test("live BrowserWindow preferences equal the contract", async () => {
  requireWindow();
  const expected = (await contract()).windowOptions().webPreferences;
  const actual = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() ?? {};
    return {
      nodeIntegration: preferences.nodeIntegration === true,
      contextIsolation: preferences.contextIsolation !== false,
      sandbox: preferences.sandbox !== false,
      webviewTag: preferences.webviewTag === true,
    };
  });
  assert.deepEqual(actual, {
    nodeIntegration: expected.nodeIntegration,
    contextIsolation: expected.contextIsolation,
    sandbox: expected.sandbox,
    webviewTag: expected.webviewTag,
  });
});
