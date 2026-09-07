import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

test("main registers every fixed IPC operation and no generic channel", () => {
  const source = fs.readFileSync(path.join(app, "src", "main", "main.ts"), "utf8");
  for (const channel of [
    "file-manager:choose-root", "file-manager:get-current-directory",
    "file-manager:navigate", "file-manager:refresh", "file-manager:set-selection", "file-manager:set-destination",
    "file-manager:create-directory", "file-manager:rename", "file-manager:copy",
    "file-manager:move", "file-manager:trash",
  ]) assert.match(source, new RegExp(`ipcMain\\.handle\\(\\s*["']${channel}["']`), channel);
  assert.doesNotMatch(source, /ipcMain\.handle\([^)]*(?:channel|operationName)/,
    "main exposes a caller-selected IPC channel");
  assert.match(source, /new RootSessionController/);
  assert.match(source, /new BatchOperationOrchestrator/);
});

test("preload maps each fixed operation and never exposes raw IPC", () => {
  const source = fs.readFileSync(path.join(app, "src", "preload", "preload.ts"), "utf8");
  const invoked = [...source.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(invoked, [
    "file-manager:choose-root", "file-manager:get-current-directory",
    "file-manager:navigate", "file-manager:refresh", "file-manager:set-selection", "file-manager:set-destination",
    "file-manager:create-directory", "file-manager:rename", "file-manager:copy",
    "file-manager:move", "file-manager:trash",
  ]);
  assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.doesNotMatch(source, /(?:send|invoke):\s*ipcRenderer/);
});

test("DMS ships as browser ESM and imports no filesystem or Electron", () => {
  const source = fs.readFileSync(path.join(app, "src", "dms", "file-manager-view.ts"), "utf8");
  assert.doesNotMatch(source, /node:fs|node:path|electron|ipcRenderer/);
  const built = fs.readFileSync(path.join(app, "dist", "dms", "file-manager-view.js"), "utf8");
  assert.doesNotMatch(built, /Object\.defineProperty\(exports|exports\./,
    "DMS was emitted as CommonJS and will fail in the browser loader");
  assert.match(built, /export function/);
});
