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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const SHIPPED_RENDERER_FILES: readonly string[] = Object.freeze([
  "index.html",
  "renderer.js",
]);

/** Only existing, declared files from the shipped renderer may be navigated to. */
export function isNavigationAllowed(
  target: string,
  rendererRoot: string = path.join(__dirname, "..", "renderer"),
): boolean {
  try {
    const url = new URL(target);
    if (url.protocol !== "file:") return false;

    const root = fs.realpathSync.native(rendererRoot);
    if (!fs.statSync(root).isDirectory()) return false;

    const candidate = fs.realpathSync.native(fileURLToPath(url));
    if (!fs.statSync(candidate).isFile()) return false;

    const relative = path.relative(root, candidate);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)) {
      return false;
    }

    return SHIPPED_RENDERER_FILES.some((name) => {
      const shippedPath = path.join(root, name);
      try {
        const shipped = fs.realpathSync.native(shippedPath);
        const shippedRelative = path.relative(root, shipped);
        if (shippedRelative === "" || shippedRelative === ".."
          || shippedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(shippedRelative)) {
          return false;
        }
        return shipped === candidate && fs.statSync(shipped).isFile();
      } catch {
        return false;
      }
    });
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
