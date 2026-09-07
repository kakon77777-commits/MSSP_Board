import { app, BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isNavigationAllowed, windowOptions } from "./security";

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(windowOptions());
  const renderer = path.join(__dirname, "..", "renderer", "index.html");
  const rendererUrl = pathToFileURL(renderer).href;
  window.webContents.on("will-navigate", (event, target) => {
    if (!isNavigationAllowed(target)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(rendererUrl);
  window.once("ready-to-show", () => window.show());
  return window;
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
