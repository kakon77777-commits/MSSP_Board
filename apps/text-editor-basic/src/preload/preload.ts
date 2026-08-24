// A0 — the whole bridge between main and the renderer.
//
// PRELOAD_API_SURFACE in ../main/security is the authority for what may appear
// on the renderer's `window`. Each name below is exposed explicitly; nothing
// here iterates a list or forwards a channel by name, because either would let
// a new channel reach the renderer without anyone deciding that it should.
//
// `ipcRenderer` is exposed nowhere. Every function is a named operation with a
// fixed channel and no caller-supplied channel argument, so the renderer can ask
// for the five things A0 defines and cannot ask for anything else. Argument
// checking happens in the main process — a check on this side runs on the side
// that can be compromised.
import { contextBridge, ipcRenderer } from "electron";

// Runs sandboxed, where `process` is Electron's restricted polyfill rather than
// Node's. `versions` is part of that polyfill.
const appVersion: string = process.versions.electron ?? "unknown";

contextBridge.exposeInMainWorld("appVersion", appVersion);

contextBridge.exposeInMainWorld("newDocument", () => ipcRenderer.invoke("document:new"));

contextBridge.exposeInMainWorld("openDocument", () => ipcRenderer.invoke("document:open"));

contextBridge.exposeInMainWorld(
  "saveDocument", (text: string) => ipcRenderer.invoke("document:save", text));

contextBridge.exposeInMainWorld(
  "saveDocumentAs", (text: string) => ipcRenderer.invoke("document:saveAs", text));

contextBridge.exposeInMainWorld(
  "setDirty", (dirty: boolean) => ipcRenderer.invoke("document:setDirty", dirty));
