// A0 / packaged launch — the entry point package.json has always declared and
// that did not exist until 2026-08-24.
//
// Everything security-relevant here comes from ./security. This file is
// deliberately thin: if it computed any boundary value of its own, the contract
// test and the running window could disagree, and the running window is the one
// users get. See tests/packaged-window.test.mjs for why that gap is not
// hypothetical — 9 contract tests passed while this file was absent.
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

import { isNavigationAllowed, windowOptions } from "./security";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow(windowOptions());
  mainWindow = win;

  // Shown after the first paint so the window never appears blank; the option
  // object sets `show: false` for exactly this.
  win.once("ready-to-show", () => win.show());

  // The renderer may not move the window off local packaged content. The
  // decision is `isNavigationAllowed`'s, not this file's — one rule, one place,
  // asserted by both suites.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isNavigationAllowed(url)) event.preventDefault();
  });

  // A new window would be a second renderer outside the options object above,
  // so there is no "open in a new window" path at all. External links are
  // handed to the OS browser rather than being loaded in-process.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
