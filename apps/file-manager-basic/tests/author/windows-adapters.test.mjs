import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

async function load(name) {
  const file = path.join(app, "dist", "fms", name);
  await assert.doesNotReject(() => fs.access(file), `RED: built FMS module is absent: ${name}`);
  return import(`${pathToFileURL(file).href}?subject=${Date.now()}-${Math.random()}`);
}

async function scratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), "app2-windows-adapter-"));
}

test("filesystem adapter creates, observes, copies and moves exact subjects", async () => {
  const { WindowsFilesystemAdapter } = await load("windows-filesystem-adapter.js");
  const adapter = new WindowsFilesystemAdapter();
  const root = await scratch();
  try {
    const sourceDir = path.join(root, "source");
    await adapter.createDirectory(sourceDir);
    await fs.writeFile(path.join(sourceDir, "a.bin"), Buffer.from([0, 1, 2, 255]));
    assert.equal(await adapter.exists(sourceDir), true);
    assert.deepEqual(await adapter.readDirectory(sourceDir), ["a.bin"]);
    assert.deepEqual(await adapter.lstat(path.join(sourceDir, "a.bin")), {
      kind: "file", byteLength: 4, isReparse: false,
    });
    await assert.doesNotReject(() => adapter.probeReadableFile(path.join(sourceDir, "a.bin")));

    const copied = path.join(root, "copied");
    await adapter.copy(sourceDir, copied);
    assert.deepEqual([...await fs.readFile(path.join(copied, "a.bin"))], [0, 1, 2, 255]);
    const moved = path.join(root, "moved");
    await adapter.move(copied, moved);
    assert.equal(await adapter.exists(copied), false);
    assert.deepEqual([...await fs.readFile(path.join(moved, "a.bin"))], [0, 1, 2, 255]);
    assert.equal(adapter.same(await adapter.realpath(root), await adapter.realpath(root)), true);
    assert.equal(adapter.parent(adapter.join(root, "source")), root);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("copy refuses an existing destination rather than overwriting", async () => {
  const { WindowsFilesystemAdapter } = await load("windows-filesystem-adapter.js");
  const adapter = new WindowsFilesystemAdapter();
  const root = await scratch();
  try {
    const source = path.join(root, "source.bin");
    const target = path.join(root, "target.bin");
    await fs.writeFile(source, Buffer.from("source"));
    await fs.writeFile(target, Buffer.from("sentinel"));
    await assert.rejects(() => adapter.copy(source, target));
    assert.equal((await fs.readFile(target, "utf8")), "sentinel");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("junction is observed as reparse without following its target", async (t) => {
  const { WindowsFilesystemAdapter } = await load("windows-filesystem-adapter.js");
  const adapter = new WindowsFilesystemAdapter();
  const root = await scratch();
  const outside = await scratch();
  try {
    const junction = path.join(root, "escape");
    try { await fs.symlink(outside, junction, "junction"); }
    catch (error) { t.skip(`junction precondition not proven: ${error.code ?? error.message}`); return; }
    const stat = await adapter.lstat(junction);
    assert.equal(stat.kind, "reparse");
    assert.equal(stat.isReparse, true);
    assert.equal(stat.byteLength, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("root picker stub labels selected and cancelled paths without native overclaim", async () => {
  const { WindowsRootPickerAdapter } = await load("windows-root-picker-adapter.js");
  const selected = new WindowsRootPickerAdapter({ stubSelection: "D:\\scratch\\root" });
  assert.deepEqual(await selected.chooseRoot(), {
    state: "selected", path: "D:\\scratch\\root", evidencePath: "stubbed",
  });
  const cancelled = new WindowsRootPickerAdapter({ stubSelection: null });
  assert.deepEqual(await cancelled.chooseRoot(), { state: "cancelled", evidencePath: "stubbed" });
});

test("root picker sequence consumes exact paths and cancellation once, then fails closed", async () => {
  const { WindowsRootPickerAdapter } = await load("windows-root-picker-adapter.js");
  const picker = new WindowsRootPickerAdapter({
    stubSequence: ["D:\\scratch\\root-a", null, "D:\\scratch\\root-b"],
  });
  assert.deepEqual(await picker.chooseRoot(), {
    state: "selected", path: "D:\\scratch\\root-a", evidencePath: "stubbed",
  });
  assert.deepEqual(await picker.chooseRoot(), { state: "cancelled", evidencePath: "stubbed" });
  assert.deepEqual(await picker.chooseRoot(), {
    state: "selected", path: "D:\\scratch\\root-b", evidencePath: "stubbed",
  });
  await assert.rejects(() => picker.chooseRoot(), /exhausted/i);
  assert.throws(() => new WindowsRootPickerAdapter({ stubSequence: [] }), /non-empty/i);
  assert.throws(() => new WindowsRootPickerAdapter({ stubSequence: [42] }), /string or null/i);
  assert.throws(() => new WindowsRootPickerAdapter({
    stubSelection: "D:\\one", stubSequence: ["D:\\two"],
  }), /exactly one stub mode/i);
});

test("recycle adapter calls only its injected recoverable operation", async () => {
  const { WindowsRecycleAdapter } = await load("windows-recycle-adapter.js");
  const calls = [];
  const adapter = new WindowsRecycleAdapter(async (subject) => { calls.push(subject); });
  await adapter.recycle("D:\\scratch\\root\\trash.txt");
  assert.deepEqual(calls, ["D:\\scratch\\root\\trash.txt"]);
  const source = await fs.readFile(path.join(app, "src", "fms", "windows-recycle-adapter.ts"), "utf8");
  assert.doesNotMatch(source, /\b(?:rm|rmSync|unlink|unlinkSync|exec|spawn)\b/,
    "recycle adapter contains a permanent-delete or shell fallback");
});

test("readability probe rejects a real Windows sharing denial and releases the helper", async () => {
  const { WindowsFilesystemAdapter } = await load("windows-filesystem-adapter.js");
  const adapter = new WindowsFilesystemAdapter();
  const root = await scratch();
  const subject = path.join(root, "denied.bin");
  await fs.writeFile(subject, Buffer.from("denied"));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$s = [System.IO.File]::Open($env:MSSP_DENIED_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)",
    "[Console]::Out.WriteLine($PID)",
    "[Console]::Out.Flush()",
    "[Console]::In.ReadLine() | Out-Null",
    "$s.Dispose()",
  ].join("\n");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, MSSP_DENIED_FILE: subject },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    const ready = await new Promise((resolve, reject) => {
      let text = "";
      const timer = setTimeout(() => reject(new Error("denied-file helper timeout")), 5_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        text += chunk;
        if (text.includes("\n")) { clearTimeout(timer); resolve(text.trim()); }
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`denied-file helper exited early: ${code}`)));
    });
    assert.equal(Number.isInteger(Number(ready)), true, "helper did not report its exact PID");
    let deniedCode = null;
    try { await adapter.probeReadableFile(subject); }
    catch (error) { deniedCode = error.code ?? error.name; }
    assert.ok(["EBUSY", "EPERM", "EACCES"].includes(deniedCode),
      `open-for-read denial was not proven: ${deniedCode}`);
  } finally {
    if (child.exitCode === null) { child.stdin.write("\n"); child.stdin.end(); await once(child, "exit"); }
    await fs.rm(root, { recursive: true, force: true });
  }
});
