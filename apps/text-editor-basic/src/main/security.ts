// A0.0 — the Electron security boundary, as one object the application uses
// and the contract test reads.
//
// It lives apart from main.ts so that the test can assert the shipped values
// without starting Electron. A test that re-stated these values in its own
// literal would be agreeing with itself; this way there is one copy and the
// test's subject moves when the app moves.
//
// Every value here is required by the preregistration's
// `electron_security_boundary` section. Changing one without changing that
// section turns the contract test red.
import path from "node:path";

export interface WindowOptions {
  width: number;
  height: number;
  show: boolean;
  webPreferences: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
    preload: string;
    webviewTag: false;
  };
}

/** The only place BrowserWindow options are constructed. */
export function windowOptions(preloadDir: string = path.join(__dirname, "..", "preload")): WindowOptions {
  return {
    width: 1000,
    height: 700,
    // Shown after the first paint, so the window never appears blank. A0.1
    // will need this when it starts driving the GUI.
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(preloadDir, "preload.js"),
      webviewTag: false,
    },
  };
}

/**
 * Restrictive CSP. No remote scheme appears here at all — not even a dev
 * server, because acceptance runs against the package and a policy that admits
 * one origin for convenience is a policy that admits origins.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * Only local packaged content may be navigated to. Returns false for every
 * remote origin, including localhost: the preregistration says acceptance runs
 * against the packaged executable and never a dev server, so permitting a dev
 * origin here would let the acceptance quietly test something else.
 */
export function isNavigationAllowed(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === "file:";
  } catch {
    return false;
  }
}

/**
 * The complete set of names the preload script may put on the renderer's
 * window. Raw `ipcRenderer` is deliberately absent and its absence is asserted,
 * not assumed — A0.1 will add the document names it needs, one at a time.
 */
export const PRELOAD_API_SURFACE: readonly string[] = Object.freeze([
  "appVersion",
  // A0's file loop. Each is a named function with checked arguments, added one
  // at a time as a workflow step needed it — never a filesystem handle and
  // never `ipcRenderer`, whose absence the contract test asserts rather than
  // assumes. A1 will add its own names the same way.
  "openDocument",
  "saveDocument",
  "saveDocumentAs",
  "newDocument",
  "setDirty",
]);
