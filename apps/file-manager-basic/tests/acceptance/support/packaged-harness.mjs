import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { materializeFixture } from "./materialize-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..", "..");
const scratchPrefix = "D:/Ai/work together/.mssp-app2-gui-";

export async function launchPackagedFixture(manifest, options = {}) {
  const root = mkdtempSync(scratchPrefix);
  materializeFixture(root, manifest);
  const stubRoot = typeof options.stubRoot === "function"
    ? options.stubRoot(root)
    : options.stubRoot ?? root;
  const env = {
    ...process.env,
    MSSP_FM_STUB_ROOT: stubRoot,
  };
  if (options.rootSequence !== undefined) {
    const sequence = typeof options.rootSequence === "function"
      ? options.rootSequence(root)
      : options.rootSequence;
    if (!Array.isArray(sequence)
        || sequence.some((entry) => entry !== null && typeof entry !== "string")) {
      throw new TypeError("rootSequence must contain only paths or null cancellation markers");
    }
    env.MSSP_FM_STUB_ROOT_SEQUENCE = JSON.stringify(sequence);
  }
  if (options.failScanAt !== undefined) env.MSSP_FM_FAIL_SCAN_AT = String(options.failScanAt);

  let electronApp = null;
  try {
    const { _electron } = await import("playwright");
    electronApp = await _electron.launch({ args: ["."], cwd: app, env });
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(10_000);
    await page.waitForLoadState("domcontentloaded");
    return {
      app,
      root,
      page,
      electronApp,
      async closeApplication() {
        if (electronApp !== null) {
          const process = electronApp.process();
          const pid = process.pid;
          await electronApp.close();
          electronApp = null;
          return { pid, exitCode: process.exitCode };
        }
        return null;
      },
      async close() {
        if (electronApp !== null) {
          await electronApp.close();
          electronApp = null;
        }
        const resolved = path.resolve(root).replaceAll("\\", "/");
        if (!resolved.startsWith(scratchPrefix)) throw new Error("refusing unsafe GUI fixture cleanup");
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (electronApp !== null) await electronApp.close().catch(() => {});
    const resolved = path.resolve(root).replaceAll("\\", "/");
    if (resolved.startsWith(scratchPrefix)) rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export async function performAndRead(page, action) {
  await page.evaluate(() => { window.__lastFileManagerResult = undefined; });
  await action();
  await page.waitForFunction(() => window.__lastFileManagerResult !== undefined);
  return page.evaluate(() => window.__lastFileManagerResult);
}

export async function chooseRoot(page) {
  return performAndRead(page, () => page.locator("#choose-root").click());
}

export async function selectEntry(page, name) {
  const row = page.locator(`#entries li[data-name=${JSON.stringify(name)}]`);
  return performAndRead(page, () => row.locator("input.entry-select").check());
}

export async function installIpcCapture(electronApp) {
  await electronApp.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    if (!(handlers instanceof Map)) throw new Error("Electron invoke-handler map is unavailable");
    globalThis.__msspAcceptanceIpcCapture = [];
    for (const [channel, handler] of handlers) {
      handlers.set(channel, async (event, ...args) => {
        globalThis.__msspAcceptanceIpcCapture.push({
          channel,
          args: JSON.parse(JSON.stringify(args)),
        });
        return handler(event, ...args);
      });
    }
  });
}

export async function readIpcCapture(electronApp) {
  return electronApp.evaluate(() => globalThis.__msspAcceptanceIpcCapture ?? null);
}
