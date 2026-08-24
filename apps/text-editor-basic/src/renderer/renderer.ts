// A0 — the renderer's only script.
//
// Loaded as a separate file rather than inlined, because the CSP declares
// `script-src 'self'` and admits no inline source. A policy that permits inline
// script for the app's own convenience is a policy that permits inline script.
//
// This file holds no filesystem logic and no policy. It calls the five named
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

interface DocResult {
  ok: boolean;
  text?: string;
  fileName?: string | null;
  error?: string;
  cancelled?: boolean;
  dialogPath?: "stubbed" | "native";
}

const doc = document.getElementById("document") as HTMLTextAreaElement | null;
const statusSlot = document.getElementById("status");
const errorSlot = document.getElementById("error");
const dirtySlot = document.getElementById("dirty");
const nameSlot = document.getElementById("name");
const versionSlot = document.getElementById("version");

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

/**
 * Run one file operation with the busy flag held for its whole duration.
 *
 * The tests wait on `data-busy` rather than on a timeout, so the flag has to be
 * set before the await and cleared in a `finally`. Clearing it only on the happy
 * path would leave a failed operation looking permanently in progress — and a
 * test waiting for `busy=false` would then hang rather than report the failure.
 */
async function run(operation: () => Promise<DocResult>): Promise<void> {
  statusSlot?.setAttribute("data-busy", "true");
  showError("");
  try {
    const result = await operation();
    if (result.dialogPath) statusSlot?.setAttribute("data-dialog-path", result.dialogPath);
    if (result.cancelled) return;
    if (!result.ok) {
      showError(result.error ?? "the operation failed");
      return;
    }
    if (typeof result.text === "string" && doc) doc.value = result.text;
    if (nameSlot) nameSlot.textContent = result.fileName ?? "untitled";
    await markDirty(false);
  } catch (raised) {
    showError(String(raised));
  } finally {
    statusSlot?.setAttribute("data-busy", "false");
  }
}

doc?.addEventListener("input", () => { void markDirty(true); });

document.getElementById("new")?.addEventListener("click", () => {
  if (typeof newDocument === "function") void run(newDocument);
});
document.getElementById("open")?.addEventListener("click", () => {
  if (typeof openDocument === "function") void run(openDocument);
});
document.getElementById("save")?.addEventListener("click", () => {
  if (typeof saveDocument === "function" && doc) void run(() => saveDocument(doc.value));
});
document.getElementById("save-as")?.addEventListener("click", () => {
  if (typeof saveDocumentAs === "function" && doc) void run(() => saveDocumentAs(doc.value));
});
