// A0 — the entry point package.json has always declared.
//
// Everything security-relevant comes from ./security; all filesystem work comes
// from ./documents. This file is the wiring, and it is deliberately thin: if it
// computed a boundary value of its own, the contract test and the running window
// could disagree, and the running window is the one users get.
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import path from "node:path";

import { boundarySnapshot, outputFormat } from "./boundary-snapshot";
import {
  DocumentRefusal, newDocument, readDocument, serialiseDocument,
  setDocumentFormatCodec, writeDocument,
} from "./documents";
import { isNavigationAllowed, windowOptions } from "./security";
import { utf8DocumentCodec } from "../tms/encoding/utf8-document-codec";
import type {
  BoundarySnapshot, DocumentFormat, DocumentOperation, DocumentOperationResult,
  DocumentRefusal as RefusalRecord, DocumentRefusalCode,
} from "../sms/document-format-contract";

/**
 * The one document this window holds. A0 is single-document by design.
 *
 * `format` is the codec's own measurement, carried whole. The two loose fields
 * it replaces described the same fact a second time and had nowhere to put the
 * byte count, so the count could not reach the window that displays it.
 */
interface OpenDocument {
  filePath: string | null;
  format: DocumentFormat;
  dirty: boolean;
}

let current: OpenDocument = {
  filePath: null, format: newDocument().format, dirty: false,
};
// Distinguish a newer edit report from the one a pending Save started with.
// Native Save As can leave the main process awaiting a dialog while the
// renderer continues to report edits; that later dirty state must survive the
// older write completing.
/**
 * The boundary the window is entitled to show right now.
 *
 * Built from `current`, which was set from what the codec measured. Nothing here
 * recomputes a format: a boundary that derived its own would be able to disagree
 * with the file that was actually opened, and the window would show the
 * disagreement as fact.
 */
function currentBoundary(): BoundarySnapshot {
  return boundarySnapshot(current.format, current.filePath, current.dirty, boundaryGeneration);
}

/**
 * How many boundaries this window has published.
 *
 * Deliberately separate from `documentEpoch`. That one means "the document
 * identity changed" and a pending dialog refuses on it; a Save does not change
 * identity but does publish a boundary, so sharing one counter would make every
 * save cancel an in-flight Open for a reason that never happened.
 */
let boundaryGeneration = 0;

let dirtyRevision = 0;
let documentEpoch = 0;

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

function requireBoolean(value: unknown, channel: string): boolean {
  if (typeof value !== "boolean") {
    throw new DocumentRefusal(channel, "expected a boolean argument");
  }
  return value;
}

function requireArgumentCount(args: unknown[], expected: number, channel: string): void {
  if (args.length === expected) return;
  const shape = expected === 0
    ? "expected no arguments"
    : `expected exactly ${expected} argument${expected === 1 ? "" : "s"}`;
  throw new DocumentRefusal(channel, shape);
}

/**
 * The three results a document operation can have.
 *
 * `cancelled` and `refused` are distinct variants rather than one `ok: false`
 * with optional fields, because a reader that has to guess which one it holds
 * will eventually guess wrong, and they mean opposite things about whether the
 * user asked for something that then failed.
 *
 * Both carry the boundary UNCHANGED, and neither advances the generation. That
 * is what lets a caller prove the current document did not move: an unchanged
 * generation is evidence, where an absent field would only be silence.
 */
function accepted(
  operation: DocumentOperation, text?: string,
): DocumentOperationResult {
  boundaryGeneration += 1;
  const result: DocumentOperationResult = {
    status: "accepted", operation, boundary: currentBoundary(), dialogPath: dialogPathMark(),
  };
  return text === undefined ? result : { ...result, text };
}

function cancelled(operation: DocumentOperation): DocumentOperationResult {
  return {
    status: "cancelled", operation, boundary: currentBoundary(), dialogPath: dialogPathMark(),
  };
}

function refused(
  operation: DocumentOperation, refusal: RefusalRecord,
): DocumentOperationResult {
  return {
    status: "refused", operation, refusal,
    boundary: currentBoundary(), dialogPath: dialogPathMark(),
  };
}

/** Carry a thrown refusal across the boundary with its own code, not a guessed one. */
function refusalRecord(
  raised: unknown, fallbackName: string | null, fallbackCode: DocumentRefusalCode,
): RefusalRecord {
  if (raised instanceof DocumentRefusal) {
    return { code: raised.code, fileName: raised.fileName, message: raised.message };
  }
  return { code: fallbackCode, fileName: fallbackName, message: String(raised) };
}

/** Refuse a destructive document transition without changing current state. */
function unsavedChangeRefusal(operation: DocumentOperation): DocumentOperationResult {
  const label = operation === "new" ? "New" : "Open";
  return refused(operation, {
    code: "dirty_transition_blocked",
    fileName: current.filePath === null ? null : path.basename(current.filePath),
    message: `${label} refused: save the current document before replacing unsaved changes`,
  });
}

function registerChannels(): void {
  // Every handler validates its own arguments here in the main process. A check
  // in the preload would run on the side that can be compromised.
  ipcMain.handle("document:new", (_event, ...args: unknown[]) => {
    requireArgumentCount(args, 0, "document:new");
    if (current.dirty) return unsavedChangeRefusal("new");
    current = { filePath: null, format: newDocument().format, dirty: false };
    documentEpoch += 1;
    return accepted("new", "");
  });

  ipcMain.handle("document:open", async (event, ...args: unknown[]) => {
    requireArgumentCount(args, 0, "document:open");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return noWindow("open");
    const startedDirtyRevision = dirtyRevision;
    if (current.dirty) return unsavedChangeRefusal("open");
    const startedEpoch = documentEpoch;
    const chosen = await choosePath(win, "open");
    if (chosen === null) return cancelled("open");
    if (documentEpoch !== startedEpoch) {
      return refused("open", {
        code: "stale_document",
        fileName: null,
        message: "Open refused: the document changed while open was pending",
      });
    }
    // A native dialog yields the event loop. Refuse if an edit arrived while it
    // was open instead of replacing content that was clean only at click time.
    if (dirtyRevision !== startedDirtyRevision && current.dirty) {
      return unsavedChangeRefusal("open");
    }
    try {
      const doc = readDocument(chosen);
      current = { filePath: path.resolve(chosen), format: doc.format, dirty: false };
      documentEpoch += 1;
      return accepted("open", doc.text);
    } catch (raised) {
      // The refusal reaches the GUI carrying the file's name, because
      // error-report's acceptance row is "refused BY NAME and the name reaches
      // the GUI" — a refusal that only reaches a log is not that.
      return refused("open", refusalRecord(raised, path.basename(chosen), "unreadable"));
    }
  });

  ipcMain.handle("document:save", async (event, ...args: unknown[]) => {
    requireArgumentCount(args, 1, "document:save");
    const body = requireString(args[0], "document:save");
    const started = { dirtyRevision, documentEpoch };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return noWindow("save");
    let target = current.filePath;
    if (target === null) {
      target = await choosePath(win, "save");
      if (target === null) return cancelled("save");
    }
    return writeStartedCurrent("save", target, body, started);
  });

  ipcMain.handle("document:saveAs", async (event, ...args: unknown[]) => {
    requireArgumentCount(args, 1, "document:saveAs");
    const body = requireString(args[0], "document:saveAs");
    const started = { dirtyRevision, documentEpoch };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return noWindow("save-as");
    const target = await choosePath(win, "save");
    if (target === null) return cancelled("save-as");
    return writeStartedCurrent("save-as", target, body, started);
  });

  // The renderer reports edits; main holds the flag, because main is what
  // refuses the close. A dirty flag living only in the renderer would be a
  // guard asking the compromised side whether to let it through.
  ipcMain.handle("document:setDirty", (_event, ...args: unknown[]) => {
    requireArgumentCount(args, 1, "document:setDirty");
    current.dirty = requireBoolean(args[0], "document:setDirty");
    dirtyRevision += 1;
    return { ok: true, dirty: current.dirty };
  });

  // Core 4.2: the renderer asks once on load and never derives a format itself.
  // A named channel with no selector argument, like every other operation here.
  ipcMain.handle("document:get-format-state", (_event, ...args: unknown[]) => {
    requireArgumentCount(args, 0, "document:get-format-state");
    return currentBoundary();
  });

  // Clipboard is an external boundary, but Electron's text API has already
  // produced a JavaScript string. Preserve that string exactly; do not invent
  // a byte decoder and then claim it measured malformed clipboard bytes.
  ipcMain.handle("clipboard:readText", (_event, ...args: unknown[]) => {
    requireArgumentCount(args, 0, "clipboard:readText");
    return { ok: true, text: clipboard.readText() };
  });

  ipcMain.handle("clipboard:writeText", (_event, ...args: unknown[]) => {
    requireArgumentCount(args, 1, "clipboard:writeText");
    const text = requireString(args[0], "clipboard:writeText");
    clipboard.writeText(text);
    return { ok: true };
  });
}

function writeStartedCurrent(
  operation: DocumentOperation,
  target: string,
  body: string,
  started: { dirtyRevision: number; documentEpoch: number },
): DocumentOperationResult {
  // A dialog can outlive the document it was opened for. Do not write stale
  // bytes (or apply stale BOM/EOL metadata) once New/Open changed identity.
  if (documentEpoch !== started.documentEpoch) {
    return refused(operation, {
      code: "stale_document",
      fileName: path.basename(target),
      message: "Save refused: the document changed while save was pending",
    });
  }
  const written = writeCurrent(target, body);
  if (written.refusal !== null) {
    // `unwritable` must leave the document dirty. Nothing below runs, so the
    // boundary this returns is the one that was already true.
    return refused(operation, written.refusal);
  }
  // The state is updated BEFORE the boundary is built. Building it first
  // published the identity the document had a moment ago: a packaged Save As
  // reported the previous name and generation while the bytes were already on
  // disk under the new one.
  //
  // Any intervening report is conservatively dirty. The renderer knows the
  // exact saved text and immediately reconciles this against its history; main
  // must not create a transient clean window before that round trip.
  current = {
    ...current,
    filePath: path.resolve(target),
    dirty: dirtyRevision !== started.dirtyRevision,
  };
  return accepted(operation);
}

function noWindow(operation: DocumentOperation): DocumentOperationResult {
  return refused(operation, {
    code: "no_window", fileName: null, message: "no window",
  });
}

// Keep the A0 write boundary focused on the actual write. The existing
// failed-save drill mutates this function's catch branch and must continue to
// exercise the production error path rather than silently measuring nothing.
function writeCurrent(target: string, body: string): { refusal: RefusalRecord | null } {
  try {
    writeDocument(target, serialiseDocument(body, outputFormat(current.format)));
    return { refusal: null };
  } catch (raised) {
    return { refusal: refusalRecord(raised, path.basename(target), "unwritable") };
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
  setDocumentFormatCodec(utf8DocumentCodec);
  registerChannels();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
