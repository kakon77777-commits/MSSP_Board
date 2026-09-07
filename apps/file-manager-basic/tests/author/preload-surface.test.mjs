import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const preload = path.join(app, "dist", "preload", "preload.js");
const security = path.join(app, "dist", "main", "security.js");

async function declared() {
  const module = await import(`${pathToFileURL(security).href}?${Date.now()}`);
  return [...module.PRELOAD_API_SURFACE];
}

function observe() {
  const registrations = [];
  const raw = Object.freeze({ __rawIpcRendererSentinel: true, invoke() {} });
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { registrations.push({ name, value }); } },
    ipcRenderer: raw,
  };
  const module = { exports: {} };
  const context = vm.createContext({
    exports: module.exports,
    module,
    require(specifier) {
      assert.equal(specifier, "electron");
      return electron;
    },
  });
  new vm.Script(fs.readFileSync(preload, "utf8"), { filename: preload })
    .runInContext(context, { timeout: 1_000 });
  return { registrations, raw };
}

test("compiled preload exposes one named API object with exact closed members", async () => {
  const { registrations } = observe();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "fileManager");
  assert.deepEqual(Object.keys(registrations[0].value).sort(), (await declared()).sort());
  assert.ok(Object.values(registrations[0].value).every((value) => typeof value === "function"));
});

test("compiled preload never exposes raw ipcRenderer directly or as a member", () => {
  const { registrations, raw } = observe();
  assert.ok(registrations.every(({ name, value }) => name !== "ipcRenderer" && value !== raw));
  assert.ok(registrations.every(({ value }) => Object.values(value).every((member) => member !== raw)));
});
