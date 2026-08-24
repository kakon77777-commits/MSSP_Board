// A0 / packaged launch — exact compiled-preload surface contract.
//
// packaged-window.test.mjs proves every declared preload name appears in a
// live renderer. That is only one half of "exact": an additional, undeclared
// exposeInMainWorld call would still pass that check. This suite executes the
// BUILT preload with a deliberately tiny Electron double and records every
// bridge registration, so undeclared, missing, and duplicate registrations
// are observable without weakening the live-window gate.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const BUILT_PRELOAD = path.join(app, "dist", "preload", "preload.js");
const BUILT_SECURITY = path.join(app, "dist", "main", "security.js");

async function declaredSurface() {
  assert.ok(existsSync(BUILT_SECURITY),
    "dist/main/security.js is missing. Build first: npm run build");
  const { PRELOAD_API_SURFACE } = await import(pathToFileURL(BUILT_SECURITY).href);
  assert.ok(Array.isArray(PRELOAD_API_SURFACE), "no declared preload surface");
  return [...PRELOAD_API_SURFACE];
}

function observeCompiledPreload() {
  assert.ok(existsSync(BUILT_PRELOAD),
    "dist/preload/preload.js is missing. Build first: npm run build");

  const registrations = [];
  const electron = Object.freeze({
    contextBridge: Object.freeze({
      exposeInMainWorld(name, value) {
        registrations.push({ name, value });
      },
    }),
    // The sentinel makes a mutation which exposes raw ipcRenderer observable
    // even if it hides that object behind an otherwise declared name.
    ipcRenderer: Object.freeze({ __rawIpcRendererSentinel: true }),
  });

  const module = { exports: {} };
  const context = vm.createContext({
    exports: module.exports,
    module,
    process: Object.freeze({ versions: Object.freeze({ electron: "contract-probe" }) }),
    require(specifier) {
      assert.equal(specifier, "electron", `compiled preload required unexpected module: ${specifier}`);
      return electron;
    },
  });

  const source = readFileSync(BUILT_PRELOAD, "utf8");
  new vm.Script(source, { filename: BUILT_PRELOAD }).runInContext(context, { timeout: 1_000 });
  return { registrations };
}

test("the compiled preload registers exactly the declared names once", async () => {
  const declared = await declaredSurface();
  const { registrations } = observeCompiledPreload();
  const observed = registrations.map(({ name }) => name);

  assert.equal(new Set(declared).size, declared.length,
    "the declared preload surface contains duplicate names");
  assert.equal(new Set(observed).size, observed.length,
    "the compiled preload registers one name more than once");
  assert.deepEqual(observed.toSorted(), declared.toSorted(),
    "compiled preload registrations do not exactly equal PRELOAD_API_SURFACE");
});

test("the compiled preload never exposes raw ipcRenderer", async () => {
  const { registrations } = observeCompiledPreload();
  assert.ok(registrations.every(({ name, value }) =>
    name !== "ipcRenderer" && value?.__rawIpcRendererSentinel !== true),
  "compiled preload exposes raw ipcRenderer");
});
