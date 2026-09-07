import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const securityFile = path.join(app, "dist", "main", "security.js");
const rendererEntry = path.join(app, "dist", "renderer", "index.html");
const expectedSurface = [
  "chooseRoot",
  "getCurrentDirectory",
  "navigate",
  "refresh",
  "setSelection",
  "createDirectory",
  "renameEntries",
  "copyEntries",
  "moveEntries",
  "trashEntries",
];

async function loadSecurity() {
  assert.ok(existsSync(securityFile),
    "RED: dist/main/security.js is absent; implement and build the App-2 security boundary");
  return import(`${pathToFileURL(securityFile).href}?subject=${Date.now()}`);
}

test("package entry names the real built main module", () => {
  const packageFile = path.join(app, "package.json");
  assert.ok(existsSync(packageFile), "RED: apps/file-manager-basic/package.json is absent");
  const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
  assert.equal(packageJson.main, "dist/main/main.js");
});

test("BrowserWindow options close Node and renderer escape hatches", async () => {
  const { windowOptions } = await loadSecurity();
  const preferences = windowOptions().webPreferences;
  assert.deepEqual({
    nodeIntegration: preferences.nodeIntegration,
    contextIsolation: preferences.contextIsolation,
    sandbox: preferences.sandbox,
    webviewTag: preferences.webviewTag,
  }, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
  });
  assert.match(preferences.preload, /preload\.js$/);
});

test("CSP admits shipped local assets and no remote or eval source", async () => {
  const { contentSecurityPolicy } = await loadSecurity();
  const csp = contentSecurityPolicy();
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /https?:|unsafe-eval|unsafe-inline/);
});

test("navigation admits only declared shipped renderer files", async () => {
  const { isNavigationAllowed } = await loadSecurity();
  assert.equal(isNavigationAllowed("https://example.com"), false);
  assert.equal(isNavigationAllowed("http://127.0.0.1:5173"), false);
  assert.equal(isNavigationAllowed(pathToFileURL(rendererEntry).href), true,
    "the actual shipped entry is the positive control");
  const undeclared = path.join(app, "dist", "renderer", "undeclared.html");
  assert.equal(isNavigationAllowed(pathToFileURL(undeclared).href), false);
});

test("preload surface is exact and cannot expose a channel selector", async () => {
  const { PRELOAD_API_SURFACE } = await loadSecurity();
  assert.deepEqual([...PRELOAD_API_SURFACE], expectedSurface);
  assert.equal(PRELOAD_API_SURFACE.includes("ipcRenderer"), false);
  assert.equal(PRELOAD_API_SURFACE.includes("invoke"), false);
  assert.equal(PRELOAD_API_SURFACE.includes("send"), false);
});
