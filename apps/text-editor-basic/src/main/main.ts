// A0 — the entry point package.json has always declared.
//
// Everything security-relevant comes from ./security; all filesystem work comes
// from ./documents. This file is the wiring, and it is deliberately thin: if it
// computed a boundary value of its own, the contract test and the running window
// could disagree, and the running window is the one users get.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import {
  DocumentRefusal, newDocument, readDocument, serialiseDocument, writeDocument,
  type Eol,
} from "./documents";
import { isNavigationAllowed, windowOptions } from "./security";

/** The one document this window holds. A0 is single-document by design. */
interface OpenDocument {
  filePath: string | null;
  bom: boolean;
  eol: Eol;
  dirty: boolean;
}

let current: OpenDocument = { filePath: null, ...newDocument(), dirty: false };

const TEST_MODE = process.env.TEXT_EDITOR_TEST_MODE === "1";

/**
 * The path an Open/Save As dialog would return.
 *
 * `dialog_coverage` permits the automated run to take pinned paths from the main
 * process, on one condition: "the automated path may never be reported as
 * native-dialog coverage." So the stub and the mark are produced by the same
 * branch — a run cannot take a pinned path without also being marked stubbed,
 * because there is no code path that does one without the other.
 */
async function choosePath(win: BrowserWindow, mode: "open" | "save"): Promise<string | null> {
  if (TEST_MODE) {
    const pinned = (globalThis as Record<string, unknown>).__testDialogPath;
    return typeof pinned === "string" && pinned.length > 0 ? pinned : null;
  }
  if (mode === "open") {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  }
  const r = await dialog.showSaveDialog(win, {});
  return r.canceled || !r.filePath ? null : r.filePath;
}

/** `dialog_path` for the report. Derived from the same flag `choosePath` reads. */
const dialogPathMark = (): "stubbed" | "native" => (TEST_MODE ? "stubbed" : "native");

/** Reject anything that is not the shape this channel declared. */
function requireString(value: unknown, channel: string): string {
  if (typeof value !== "string") {
    throw new DocumentRefusal(channel, "expected a string argument");
  }
  return value;
}

/** Refuse a destructive document transition without changing current state. */
function unsavedChangeRefusal(operation: "New" | "Open") {
  return {
    ok: false,
    blocked: true,
    error: `${operation} refused: save the current document before replacing unsaved changes`,
  };
}

function registerChannels(): void {
  // Every handler validates its own arguments here in the main process. A check
  // in the preload would run on the side that can be compromised.
  ipcMain.handle("document:new", () => {
    if (current.dirty) return unsavedChangeRefusal("New");
    current = { filePath: null, ...newDocument(), dirty: false };
    return { ok: true, text: "", fileName: null, dialogPath: dialogPathMark() };
  });

  ipcMain.handle("document:open", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "no window" };
    if (current.dirty) return unsavedChangeRefusal("Open");
    const chosen = await choosePath(win, "open");
    if (chosen === null) return { ok: false, cancelled: true, dialogPath: dialogPathMark() };
    try {
      const doc = readDocument(chosen);
      current = { filePath: path.resolve(chosen), bom: doc.bom, eol: doc.eol, dirty: false };
      return {
        ok: true, text: doc.text, fileName: path.basename(chosen),
        dialogPath: dialogPathMark(),
      };
    } catch (raised) {
      // The refusal reaches the GUI carrying the file's name, because
      // error-report's acceptance row is "refused BY NAME and the name reaches
      // the GUI" — a refusal that only reaches a log is not that.
      return {
        ok: false,
        error: raised instanceof DocumentRefusal ? raised.message : String(raised),
        dialogPath: dialogPathMark(),
      };
    }
  });

  ipcMain.handle("document:save", async (event, text: unknown) => {
    const body = requireString(text, "document:save");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "no window" };
    let target = current.filePath;
    if (target === null) {
      target = await choosePath(win, "save");
      if (target === null) return { ok: false, cancelled: true, dialogPath: dialogPathMark() };
    }
    return writeCurrent(target, body);
  });

  ipcMain.handle("document:saveAs", async (event, text: unknown) => {
    const body = requireString(text, "document:saveAs");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "no window" };
    const target = await choosePath(win, "save");
    if (target === null) return { ok: false, cancelled: true, dialogPath: dialogPathMark() };
    return writeCurrent(target, body);
  });

  // The renderer reports edits; main holds the flag, because main is what
  // refuses the close. A dirty flag living only in the renderer would be a
  // guard asking the compromised side whether to let it through.
  ipcMain.handle("document:setDirty", (_event, dirty: unknown) => {
    current.dirty = dirty === true;
    return { ok: true, dirty: current.dirty };
  });
}

function writeCurrent(target: string, body: string) {
  try {
    writeDocument(target, serialiseDocument(body, current));
    current = { ...current, filePath: path.resolve(target), dirty: false };
    return {
      ok: true, fileName: path.basename(target), dialogPath: dialogPathMark(),
    };
  } catch (raised) {
    return {
      ok: false,
      error: raised instanceof DocumentRefusal ? raised.message : String(raised),
      dialogPath: dialogPathMark(),
    };
  }
}

function createWindow(): void {
  const win = new BrowserWindow(windowOptions());
  win.once("ready-to-show", () => win.show());

  win.webContents.on("will-navigate", (event, url) => {
    if (!isNavigationAllowed(url)) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // unsaved-change-guard. Its acceptance row is an ATTACK: "close with unsaved
  // changes by a route the acceptance does not drive". Hooking `close` covers
  // the window button, the menu, and a programmatic w.close() alike, because
  // the refusal is not attached to any one control.
  //
  // A0 REFUSES and stops there. There is no discard-and-close escape hatch,
  // because a flag that is declared and never set is a branch that cannot be
  // shown to fire. The save-or-discard dialog belongs to the dialog work in A2.
  win.on("close", (event) => {
    if (current.dirty) {
      event.preventDefault();
      win.webContents.send("document:close-blocked");
    }
  });

  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
    .then(() =>
      // Main is the authority on whether dialogs were stubbed, so main writes
      // the mark. A renderer that decided this for itself could report native
      // coverage for a run that never opened a native dialog.
      win.webContents.executeJavaScript(
        `document.getElementById("status")?.setAttribute("data-dialog-path", ${
          JSON.stringify(dialogPathMark())});`));
}

app.whenReady().then(() => {
  registerChannels();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
