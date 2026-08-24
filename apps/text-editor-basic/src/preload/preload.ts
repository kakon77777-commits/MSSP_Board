// A0 / packaged launch — the whole bridge between main and the renderer.
//
// PRELOAD_API_SURFACE in ../main/security is the authority for what may appear
// on the renderer's `window`. This file iterates nothing and invents nothing:
// each name is exposed explicitly, and tests/packaged-window.test.mjs asks the
// live page which of the declared names are actually there AND that
// `ipcRenderer` is not.
//
// `ipcRenderer` is imported nowhere in this file. That is not an oversight to
// be corrected when A1 needs IPC — each channel A1 adds gets its own named,
// argument-checked function here, never the raw object.
import { contextBridge } from "electron";

// Runs sandboxed, where `process` is Electron's restricted polyfill rather than
// Node's. `versions` is part of that polyfill.
const appVersion: string = process.versions.electron ?? "unknown";

contextBridge.exposeInMainWorld("appVersion", appVersion);
