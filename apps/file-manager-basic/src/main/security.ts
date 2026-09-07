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

export function windowOptions(
  preloadDir: string = path.join(__dirname, "..", "preload"),
): WindowOptions {
  return {
    width: 1100,
    height: 760,
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

const SHIPPED_RENDERER_FILES = Object.freeze([
  "index.html",
  "renderer.js",
  "styles.css",
]);

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
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)) return false;
    return SHIPPED_RENDERER_FILES.some((name) => {
      try {
        const shipped = fs.realpathSync.native(path.join(root, name));
        return shipped === candidate && fs.statSync(shipped).isFile();
      } catch { return false; }
    });
  } catch { return false; }
}

export const PRELOAD_API_SURFACE = Object.freeze([
  "chooseRoot",
  "getCurrentDirectory",
  "navigate",
  "refresh",
  "setSelection",
  "setDestination",
  "createDirectory",
  "renameEntries",
  "copyEntries",
  "moveEntries",
  "trashEntries",
]);
