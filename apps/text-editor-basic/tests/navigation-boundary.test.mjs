// A0 / local navigation boundary — file: is a scheme, not an authority.
//
// The first implementation accepted every file: URL. That makes the remote
// navigation test green while still allowing a renderer compromise to move the
// window to an arbitrary local file. These tests pin the actual shipped entry
// and asset set instead of treating the whole machine as packaged content.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILT = path.join(here, "..", "dist", "main", "security.js");

let sandbox;
let rendererRoot;
let outsideDir;

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mssp-nav-boundary-"));
  rendererRoot = path.join(sandbox, "renderer");
  outsideDir = path.join(sandbox, "outside");
  fs.mkdirSync(rendererRoot);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(rendererRoot, "index.html"), "<!doctype html>\n", "utf8");
  fs.writeFileSync(path.join(rendererRoot, "renderer.js"), "// shipped asset\n", "utf8");
  fs.writeFileSync(path.join(rendererRoot, "unused.html"), "not shipped\n", "utf8");
  fs.writeFileSync(path.join(outsideDir, "secret.txt"), "outside\n", "utf8");
});

after(() => {
  assert.match(path.basename(sandbox), /^mssp-nav-boundary-/,
    "refusing to remove a directory not created by this test");
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function allowed(target) {
  const { isNavigationAllowed } = await import(pathToFileURL(BUILT).href);
  return isNavigationAllowed(target, rendererRoot);
}

test("allows the shipped renderer entry", async () => {
  assert.equal(await allowed(pathToFileURL(path.join(rendererRoot, "index.html")).href), true);
});

test("allows the shipped renderer script", async () => {
  assert.equal(await allowed(pathToFileURL(path.join(rendererRoot, "renderer.js")).href), true);
});

test("allows a query and fragment only when their underlying entry is shipped", async () => {
  const entry = pathToFileURL(path.join(rendererRoot, "index.html"));
  entry.search = "?mode=normal";
  entry.hash = "#document";
  assert.equal(await allowed(entry.href), true);
});

test("rejects an existing but undeclared file under the renderer root", async () => {
  assert.equal(await allowed(pathToFileURL(path.join(rendererRoot, "unused.html")).href), false);
});

test("rejects an arbitrary local file outside the renderer root", async () => {
  assert.equal(await allowed(pathToFileURL(path.join(outsideDir, "secret.txt")).href), false);
});

test("rejects a lexical traversal out of the renderer root", async () => {
  const traversal = `${pathToFileURL(`${rendererRoot}${path.sep}`).href}../outside/secret.txt`;
  assert.equal(await allowed(traversal), false);
});

test("rejects a percent-encoded traversal out of the renderer root", async () => {
  const traversal = `${pathToFileURL(`${rendererRoot}${path.sep}`).href}%2e%2e/outside/secret.txt`;
  assert.equal(await allowed(traversal), false);
});

test("rejects encoded path separators", async () => {
  const encodedSeparator = `${pathToFileURL(`${rendererRoot}${path.sep}`).href}nested%2Findex.html`;
  assert.equal(await allowed(encodedSeparator), false);
});

test("rejects a nonexistent path even when it is under the renderer root", async () => {
  assert.equal(await allowed(pathToFileURL(path.join(rendererRoot, "missing.html")).href), false);
});

test("rejects the renderer directory itself", async () => {
  assert.equal(await allowed(pathToFileURL(rendererRoot).href), false);
});

test("rejects non-file schemes", async () => {
  for (const target of [
    "https://example.com/",
    "http://127.0.0.1:5173/",
    "data:text/html,hello",
    "javascript:alert(1)",
  ]) {
    assert.equal(await allowed(target), false, target);
  }
});

test("rejects a directory junction that escapes the renderer root", async (t) => {
  const link = path.join(rendererRoot, "linked-outside");
  try {
    fs.symlinkSync(outsideDir, link, "junction");
  } catch (error) {
    t.skip(`junction unavailable: ${error.code ?? error.message}`);
    return;
  }
  const escaped = pathToFileURL(path.join(link, "secret.txt")).href;
  assert.equal(await allowed(escaped), false);
});

