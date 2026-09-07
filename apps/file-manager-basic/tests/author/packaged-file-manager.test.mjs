import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
let root;
let electronApp;
let page;
let launchError;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "app2-packaged-workflow-"));
  await fs.mkdir(path.join(root, "child"));
  await fs.writeFile(path.join(root, "a.txt"), "a");
  await fs.writeFile(path.join(root, "b.txt"), "bb");
  await fs.writeFile(path.join(root, "child", "nested.txt"), "nested");
  try {
    const { _electron } = await import("playwright");
    electronApp = await _electron.launch({
      args: ["."],
      cwd: app,
      env: { ...process.env, MSSP_FM_STUB_ROOT: root },
    });
    page = await electronApp.firstWindow();
    page.setDefaultTimeout(5_000);
    await page.waitForLoadState("domcontentloaded");
  } catch (error) { launchError = error; }
});

after(async () => {
  if (electronApp) await electronApp.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

function requireWindow() {
  if (launchError) assert.fail(launchError.message);
  assert.ok(page, "no packaged file-manager window");
}

async function waitGeneration(value) {
  await page.locator("#generation").waitFor({ state: "visible" });
  await page.waitForFunction((expected) => document.querySelector("#generation")?.textContent === String(expected), value);
}

async function selectEntry(name) {
  const row = page.locator(`#entries li[data-name=${JSON.stringify(name)}]`);
  await row.locator("input.entry-select").check();
  await page.waitForFunction(() => document.querySelector("#selection")?.textContent !== "None");
}

test("packaged GUI drives root, view, navigation, refresh, selection and mutations", async () => {
  requireWindow();
  assert.equal(await page.locator("#root-label").textContent(), "No root selected");
  await page.locator("#choose-root").click();
  await waitGeneration(1);
  assert.equal(await page.locator("#evidence-path").textContent(), "stubbed");
  assert.deepEqual(await page.locator("#entries li").evaluateAll((rows) => rows.map((row) => row.dataset.name)), ["a.txt", "b.txt", "child"]);
  assert.equal((await page.locator("body").textContent()).includes(root), false, "renderer leaked selected filesystem path");

  await selectEntry("a.txt");
  assert.equal(await page.locator("#generation").textContent(), "1", "selection published a snapshot");

  await page.locator('#entries li[data-name="child"] button.entry-open').click();
  await waitGeneration(2);
  assert.deepEqual(await page.locator("#entries li").evaluateAll((rows) => rows.map((row) => row.dataset.name)), ["nested.txt"]);
  await page.locator("#navigate-parent").click();
  await waitGeneration(3);
  await page.locator("#refresh").click();
  await waitGeneration(4);

  await page.locator("#name-input").fill("new-folder");
  await page.locator("#create-directory").click();
  await waitGeneration(5);
  assert.equal(await fs.stat(path.join(root, "new-folder")).then((stat) => stat.isDirectory()), true);

  await selectEntry("a.txt");
  await page.locator("#name-input").fill("renamed.txt");
  await page.locator("#rename-entry").click();
  await waitGeneration(6);
  assert.equal(await fs.readFile(path.join(root, "renamed.txt"), "utf8"), "a");

  await selectEntry("renamed.txt");
  await page.locator("#destination").selectOption({ label: "child" });
  await page.locator("#copy-entries").click();
  await waitGeneration(7);
  assert.equal(await fs.readFile(path.join(root, "child", "renamed.txt"), "utf8"), "a");

  await selectEntry("b.txt");
  await page.locator("#destination").selectOption({ label: "child" });
  await page.locator("#move-entries").click();
  await waitGeneration(8);
  await assert.rejects(() => fs.access(path.join(root, "b.txt")));
  assert.equal(await fs.readFile(path.join(root, "child", "b.txt"), "utf8"), "bb");

  const last = await page.evaluate(() => window.__lastFileManagerResult);
  assert.equal(last.operation, "move");
  assert.equal(last.overallStatus, "accepted");
  assert.equal(last.snapshot.state, "current");
  assert.equal(last.evidencePath, "stubbed");
});
