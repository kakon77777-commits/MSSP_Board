// A0.0 contract: the Electron security boundary.
//
//   node --test apps/text-editor-basic/tests/
//
// This runs against the BUILT output, not the source, so it asserts what the
// application actually ships rather than what the repository looks like.
//
// It reads the real options object the main process hands to BrowserWindow.
// A test that re-states the intended values in its own literal would agree with
// itself; this one imports the single object both the app and the test use, so
// changing the app changes the test's subject.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILT = path.join(here, "..", "dist", "main", "security.js");

// The preregistration is the authority for what this contract must be, so the
// test reads it rather than carrying its own copy of the policy.
const PREREG = path.join(here, "..", "..", "..",
  "slices", "01-text-editor-basic", "preregistration.json");

async function load() {
  if (!existsSync(BUILT)) {
    assert.fail(
      `dist/main/security.js does not exist. Build first: npm run build\n`
      + `  If this is the RED phase, that is the intended absence.`);
  }
  return import(pathToFileURL(BUILT).href);
}

test("the preregistration declares an electron_security_boundary", async () => {
  const { readFileSync } = await import("node:fs");
  const d = JSON.parse(readFileSync(PREREG, "utf8"));
  assert.ok(d.electron_security_boundary, "preregistration has no security boundary section");
});

test("windowOptions disables node integration", async () => {
  const { windowOptions } = await load();
  assert.equal(windowOptions().webPreferences.nodeIntegration, false);
});

test("windowOptions enables context isolation", async () => {
  const { windowOptions } = await load();
  assert.equal(windowOptions().webPreferences.contextIsolation, true);
});

test("windowOptions enables the renderer sandbox", async () => {
  const { windowOptions } = await load();
  assert.equal(windowOptions().webPreferences.sandbox, true);
});

test("windowOptions points at a preload script rather than exposing node", async () => {
  const { windowOptions } = await load();
  const preload = windowOptions().webPreferences.preload;
  assert.ok(typeof preload === "string" && preload.length > 0, "no preload declared");
  assert.ok(preload.endsWith("preload.js"), `unexpected preload: ${preload}`);
});

test("the shipped options match what the preregistration declares", async () => {
  const { readFileSync } = await import("node:fs");
  const declared = JSON.parse(readFileSync(PREREG, "utf8")).electron_security_boundary;
  const { windowOptions } = await load();
  const wp = windowOptions().webPreferences;
  assert.equal(wp.nodeIntegration, declared.nodeIntegration);
  assert.equal(wp.contextIsolation, declared.contextIsolation);
  assert.equal(wp.sandbox, declared.renderer_sandbox);
});

test("the content security policy is restrictive and allows no remote origin", async () => {
  const { contentSecurityPolicy } = await load();
  const csp = contentSecurityPolicy();
  assert.match(csp, /default-src 'self'/, "CSP does not default to self");
  assert.doesNotMatch(csp, /https?:/, "CSP names a remote scheme");
  assert.doesNotMatch(csp, /unsafe-eval/, "CSP permits eval");
});

test("navigation to any remote origin is refused", async () => {
  const { isNavigationAllowed } = await load();
  assert.equal(isNavigationAllowed("https://example.com/"), false);
  assert.equal(isNavigationAllowed("http://127.0.0.1:5173/"), false,
    "a dev server origin must be refused too - acceptance runs against the package");
  assert.equal(isNavigationAllowed("file:///C:/app/dist/renderer/index.html"), true);
});

test("the preload surface is minimal and never exposes ipcRenderer", async () => {
  const { PRELOAD_API_SURFACE } = await load();
  assert.ok(Array.isArray(PRELOAD_API_SURFACE), "no declared preload surface");
  assert.ok(!PRELOAD_API_SURFACE.includes("ipcRenderer"),
    "raw ipcRenderer is in the exposed surface");
  assert.ok(PRELOAD_API_SURFACE.every((n) => typeof n === "string"));
});
