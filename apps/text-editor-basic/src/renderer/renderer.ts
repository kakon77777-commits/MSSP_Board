// A0 — the renderer's only script.
//
// Loaded as a separate file rather than inlined, because the CSP declares
// `script-src 'self'` and admits no inline source. A policy that permits inline
// script for the app's own convenience is a policy that permits inline script.
//
// This file holds no filesystem logic and no policy. It calls only the named
// functions the preload exposes and renders what comes back. Encoding, line
// endings, path validation and the dirty flag all live in the main process,
// where a compromised renderer cannot reach them.
//
// No imports and no exports, so tsc emits plain browser-loadable JS rather than
// a CommonJS wrapper.
declare const appVersion: string | undefined;
declare const newDocument: (() => Promise<DocResult>) | undefined;
declare const openDocument: (() => Promise<DocResult>) | undefined;
declare const saveDocument: ((text: string) => Promise<DocResult>) | undefined;
declare const saveDocumentAs: ((text: string) => Promise<DocResult>) | undefined;
declare const setDirty: ((dirty: boolean) => Promise<unknown>) | undefined;
declare const readClipboardText: (() => Promise<ClipboardResult>) | undefined;
// Supplied by the DMS bridge, which is a module and therefore deferred: this is
// undefined while the classic scripts parse, exactly like the preload globals.
declare const renderBoundary:
  ((snapshot: unknown, refusal: unknown) => void) | undefined;
declare const writeClipboardText: ((text: string) => Promise<ClipboardResult>) | undefined;

interface DocResult {
  ok: boolean;
  text?: string;
  fileName?: string | null;
  error?: string;
  cancelled?: boolean;
  dialogPath?: "stubbed" | "native";
  /** What the main process measured. The renderer projects it and decides none of it. */
  boundary?: unknown;
}

interface ClipboardResult {
  ok: boolean;
  text?: string;
  error?: string;
}

type FileSuccess = (result: DocResult) => Promise<void> | void;

const doc = document.getElementById("document") as HTMLTextAreaElement | null;
const statusSlot = document.getElementById("status");
const errorSlot = document.getElementById("error");
const dirtySlot = document.getElementById("dirty");
const nameSlot = document.getElementById("name");
const versionSlot = document.getElementById("version");
const undoControl = document.getElementById("undo") as HTMLButtonElement | null;
const redoControl = document.getElementById("redo") as HTMLButtonElement | null;
const findQuery = document.getElementById("find-query") as HTMLInputElement | null;
const replaceQuery = document.getElementById("replace-query") as HTMLInputElement | null;
const findStatus = document.getElementById("find-status");

const editingHistory = new A1Editing.EditingHistory(
  doc?.value ?? "",
  doc?.selectionStart ?? 0,
  doc?.selectionEnd ?? 0,
);

if (versionSlot) {
  versionSlot.textContent = typeof appVersion === "string" ? appVersion : "unavailable";
}

/**
 * Tell main the document changed, and only then show it.
 *
 * Order matters and the first version had it backwards: it set the attribute
 * first and awaited the IPC afterwards, so `data-dirty="true"` appeared while
 * main still believed the document was clean. A test asserting the attribute
 * passed; the close guard, which reads main's copy, let the window go. One
 * claim in two places, and the visible copy was the one that could not enforce
 * anything.
 *
 * Now main answers first and the attribute is set from main's reply, so
 * `data-dirty` is evidence about the flag that actually guards the close.
 */
async function markDirty(dirty: boolean): Promise<void> {
  if (typeof setDirty === "function") {
    const reply = await setDirty(dirty) as { dirty?: boolean } | undefined;
    dirtySlot?.setAttribute("data-dirty", String(reply?.dirty ?? dirty));
    return;
  }
  dirtySlot?.setAttribute("data-dirty", String(dirty));
}

function showError(message: string): void {
  if (errorSlot) errorSlot.textContent = message;
}

// Dirty writes are ordered. A fast Undo followed by Redo must not let an older
// IPC reply overwrite the newer main-process state or its visible projection.
let dirtyQueue: Promise<void> = Promise.resolve();
let dirtyFailure: unknown = null;

function syncDirty(dirty: boolean): Promise<void> {
  const next = dirtyQueue.then(() => markDirty(dirty));
  dirtyQueue = next.then(
    () => { dirtyFailure = null; },
    (raised) => { dirtyFailure = raised; },
  );
  return next;
}

async function drainDirtyQueue(): Promise<void> {
  // Input can append another report while an earlier IPC is pending. Continue
  // until the exact queue just awaited is still the tail; the continuation is
  // a microtask, so main is invoked before another GUI event can append work.
  while (true) {
    const pending = dirtyQueue;
    await pending;
    if (pending !== dirtyQueue) continue;
    if (dirtyFailure !== null) throw dirtyFailure;
    return;
  }
}

function currentSnapshot(): A1Snapshot {
  return {
    text: doc?.value ?? "",
    selectionStart: doc?.selectionStart ?? 0,
    selectionEnd: doc?.selectionEnd ?? 0,
  };
}

function updateHistoryControls(): void {
  if (undoControl) undoControl.disabled = !editingHistory.canUndo();
  if (redoControl) redoControl.disabled = !editingHistory.canRedo();
}

function applySnapshot(snapshot: A1Snapshot): void {
  if (!doc) return;
  doc.value = snapshot.text;
  doc.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  doc.focus();
  updateHistoryControls();
}

async function applyEdit(snapshot: A1Snapshot): Promise<void> {
  const before = currentSnapshot();
  editingHistory.record(snapshot);
  applySnapshot(snapshot);
  if (snapshot.text !== before.text) await syncDirty(editingHistory.isDirty());
}

function showFindStatus(message: string): void {
  if (findStatus) findStatus.textContent = message;
}

function findNextInDocument(): void {
  if (!doc || !findQuery || findQuery.value === "") return;
  const match = A1Editing.findNext(doc.value, findQuery.value, doc.selectionEnd);
  if (match === null) {
    showFindStatus("No match");
    return;
  }
  doc.focus();
  doc.setSelectionRange(match.selectionStart, match.selectionEnd);
  editingHistory.setSelection(match.selectionStart, match.selectionEnd);
  showFindStatus("Match found");
}

async function replaceFromSearch(): Promise<void> {
  if (!doc || !findQuery || !replaceQuery || findQuery.value === "") return;
  const before = currentSnapshot();
  const replaced = A1Editing.replaceCurrentOrNext(before, findQuery.value, replaceQuery.value);
  if (replaced === null) {
    showFindStatus("No match");
    return;
  }

  await applyEdit(replaced);
  showFindStatus("Replaced");
}

async function writeSelectedText(snapshot: A1Snapshot): Promise<boolean> {
  if (snapshot.selectionStart === snapshot.selectionEnd) return false;
  if (typeof writeClipboardText !== "function") throw new Error("clipboard write unavailable");
  const selected = snapshot.text.slice(snapshot.selectionStart, snapshot.selectionEnd);
  const result = await writeClipboardText(selected);
  if (!result.ok) throw new Error(result.error ?? "clipboard write failed");
  return true;
}

async function copySelection(): Promise<void> {
  if (!doc) return;
  await writeSelectedText(currentSnapshot());
}

async function cutSelection(): Promise<void> {
  if (!doc) return;
  const target = currentSnapshot();
  // Copy first. If the external boundary refuses, the user's content remains.
  if (!await writeSelectedText(target)) return;
  if (doc.value !== target.text) {
    throw new Error("Cut refused: the document changed while clipboard write was pending");
  }
  await applyEdit(A1Editing.replaceSelection(target, ""));
}

async function pasteClipboard(): Promise<void> {
  if (!doc) return;
  const target = currentSnapshot();
  if (typeof readClipboardText !== "function") throw new Error("clipboard read unavailable");
  const result = await readClipboardText();
  if (!result.ok || typeof result.text !== "string") {
    throw new Error(result.error ?? "clipboard read failed");
  }
  if (doc.value !== target.text) {
    throw new Error("Paste refused: the document changed while clipboard read was pending");
  }
  await applyEdit(A1Editing.replaceSelection(target, result.text));
}

/**
 * Run one file operation with the busy flag held for its whole duration.
 *
 * The tests wait on `data-busy` rather than on a timeout, so the flag has to be
 * set before the await and cleared in a `finally`. Clearing it only on the happy
 * path would leave a failed operation looking permanently in progress — and a
 * test waiting for `busy=false` would then hang rather than report the failure.
 */
let operationBusy = false;

async function runWithBusy(operation: () => Promise<void>): Promise<void> {
  if (operationBusy) return;
  operationBusy = true;
  const wasReadOnly = doc?.readOnly ?? false;
  if (doc) doc.readOnly = true;
  statusSlot?.setAttribute("data-busy", "true");
  showError("");
  try {
    await operation();
  } catch (raised) {
    showError(String(raised));
  } finally {
    if (doc) doc.readOnly = wasReadOnly;
    statusSlot?.setAttribute("data-busy", "false");
    operationBusy = false;
  }
}

async function run(
  operation: () => Promise<DocResult>,
  onSuccess: FileSuccess,
): Promise<void> {
  await runWithBusy(async () => {
    // New/Open must not overtake a dirty report still queued behind an older
    // IPC reply. Save benefits from the same ordering and uses this path too.
    await drainDirtyQueue();
    const result = await operation();
    if (result.dialogPath) statusSlot?.setAttribute("data-dialog-path", result.dialogPath);
    if (result.cancelled) return;
    if (!result.ok) {
      showError(result.error ?? "the operation failed");
      return;
    }
    if (typeof result.text === "string" && doc) doc.value = result.text;
    if (nameSlot) nameSlot.textContent = result.fileName ?? "untitled";
    if (typeof renderBoundary === "function" && result.boundary !== undefined) {
      renderBoundary(result.boundary, null);
    }
    await onSuccess(result);
  });
}

async function runEdit(operation: () => Promise<void>): Promise<void> {
  await runWithBusy(operation);
}

async function acceptNewOrOpen(): Promise<void> {
  editingHistory.reset(currentSnapshot());
  updateHistoryControls();
  await syncDirty(false);
}

async function acceptSave(savedText: string): Promise<void> {
  editingHistory.markClean(savedText);
  updateHistoryControls();
  await syncDirty(editingHistory.isDirty());
}

doc?.addEventListener("input", () => {
  editingHistory.record(currentSnapshot());
  updateHistoryControls();
  void syncDirty(editingHistory.isDirty()).catch((raised) => showError(String(raised)));
});

doc?.addEventListener("select", () => {
  editingHistory.setSelection(doc.selectionStart, doc.selectionEnd);
});

document.getElementById("new")?.addEventListener("click", () => {
  if (typeof newDocument === "function") void run(newDocument, acceptNewOrOpen);
});
document.getElementById("open")?.addEventListener("click", () => {
  if (typeof openDocument === "function") void run(openDocument, acceptNewOrOpen);
});
document.getElementById("save")?.addEventListener("click", () => {
  if (typeof saveDocument === "function" && doc) {
    const submittedText = doc.value;
    void run(() => saveDocument(submittedText), () => acceptSave(submittedText));
  }
});
document.getElementById("save-as")?.addEventListener("click", () => {
  if (typeof saveDocumentAs === "function" && doc) {
    const submittedText = doc.value;
    void run(() => saveDocumentAs(submittedText), () => acceptSave(submittedText));
  }
});

undoControl?.addEventListener("click", () => {
  void runEdit(async () => {
    const snapshot = editingHistory.undo();
    if (snapshot === null) return;
    applySnapshot(snapshot);
    await syncDirty(editingHistory.isDirty());
  });
});

redoControl?.addEventListener("click", () => {
  void runEdit(async () => {
    const snapshot = editingHistory.redo();
    if (snapshot === null) return;
    applySnapshot(snapshot);
    await syncDirty(editingHistory.isDirty());
  });
});

document.getElementById("find-next")?.addEventListener("click", findNextInDocument);

document.getElementById("replace")?.addEventListener("click", () => {
  // The accepted empty-query contract is a true no-op, including status and
  // error UI, so return before the shared operation wrapper changes either.
  if (!findQuery || findQuery.value === "") return;
  void runEdit(replaceFromSearch);
});

document.getElementById("copy")?.addEventListener("click", () => {
  void runEdit(copySelection);
});

document.getElementById("cut")?.addEventListener("click", () => {
  void runEdit(cutSelection);
});

document.getElementById("paste")?.addEventListener("click", () => {
  void runEdit(pasteClipboard);
});

updateHistoryControls();
