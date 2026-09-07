import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { materializeFixture } from "../../apps/file-manager-basic/tests/acceptance/support/materialize-fixture.mjs";
import { verifyTree } from "../../apps/file-manager-basic/tests/acceptance/support/tree-byte-oracle.mjs";
import manifest from "../../apps/file-manager-basic/tests/acceptance/fixtures/fixture-manifest.json" with { type: "json" };
import { OperationCore } from "./operation-core.ts";

async function withFixture(run) {
  const runId = randomUUID();
  const root = await fs.mkdtemp(`D:/Ai/work together/.mssp-app2-comparator-${runId}-`);
  const recycleRoot = `D:/Ai/work together/.mssp-app2-comparator-recycle-${runId}`;
  await fs.mkdir(recycleRoot);
  materializeFixture(root, manifest);
  const recycled = [];
  const core = await OperationCore.open(root, async (subject) => {
    const target = path.join(recycleRoot, path.basename(subject));
    await fs.rename(subject, target);
    recycled.push(target);
  });
  try { return await run({ root, recycleRoot, recycled, core }); }
  finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(recycleRoot, { recursive: true, force: true });
  }
}

test("comparator uses the exact independent fixture and has no product import", async () => {
  await withFixture(async ({ root, core }) => {
    assert.equal(verifyTree(root, manifest).status, "match");
    const source = await fs.readFile(new URL("./operation-core.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /apps\/file-manager-basic|src\/(?:sms|tms|fms|dms)/);
    assert.equal(core.rootDisplayName.length > 0, true);
  });
});

test("view, navigate and refresh observe the same root without paths in entries", async () => {
  await withFixture(async ({ root, core }) => {
    const view = await core.view("");
    assert.ok(view.entries.some((entry) => entry.name === "nav" && entry.kind === "directory"));
    assert.equal(JSON.stringify(view.entries).includes(root), false);
    const child = await core.navigate("", "nav");
    assert.deepEqual(child.entries.map((entry) => entry.name), ["child.txt"]);
    const parent = await core.navigate("nav", "..");
    assert.ok(parent.entries.some((entry) => entry.name === "copy-file.bin"));
    await fs.writeFile(path.join(root, "external.txt"), "external");
    const refreshed = await core.refresh("");
    assert.ok(refreshed.entries.some((entry) => entry.name === "external.txt"));
  });
});

test("create and rename are bounded to one validated segment", async () => {
  await withFixture(async ({ root, core }) => {
    await core.createDirectory("", "created");
    assert.equal((await fs.stat(path.join(root, "created"))).isDirectory(), true);
    await core.rename("", "rename-me.txt", "renamed.txt");
    assert.equal(await fs.readFile(path.join(root, "renamed.txt"), "utf8"), "rename-me\n");
    await assert.rejects(() => core.createDirectory("", "../escape"));
    await assert.rejects(() => core.rename("", "renamed.txt", "CON"));
  });
});

test("copy and move preserve file and directory bytes in one operation call", async () => {
  await withFixture(async ({ root, core }) => {
    await core.copy("", ["copy-file.bin", "copy-dir"], "dest-copy");
    assert.deepEqual(
      await fs.readFile(path.join(root, "dest-copy", "copy-file.bin")),
      await fs.readFile(path.join(root, "copy-file.bin")),
    );
    assert.equal(await fs.readFile(path.join(root, "dest-copy", "copy-dir", "nested", "a.txt"), "utf8"), "copy-a\n");
    await core.move("", ["move-file.txt", "move-dir"], "dest-move");
    await assert.rejects(() => fs.access(path.join(root, "move-file.txt")));
    assert.equal(await fs.readFile(path.join(root, "dest-move", "move-file.txt"), "utf8"), "move-file\n");
    assert.equal(await fs.readFile(path.join(root, "dest-move", "move-dir", "nested.txt"), "utf8"), "move-dir-child\n");
  });
});

test("conflicts refuse without overwrite and trash uses only injected recycle", async () => {
  await withFixture(async ({ root, core, recycled }) => {
    const sentinel = await fs.readFile(path.join(root, "dest-copy-conflict", "copy-file.bin"));
    await assert.rejects(() => core.copy("", ["copy-file.bin"], "dest-copy-conflict"), /conflict/i);
    assert.deepEqual(await fs.readFile(path.join(root, "dest-copy-conflict", "copy-file.bin")), sentinel);
    await core.trash("", ["trash-file.txt", "trash-dir"]);
    await assert.rejects(() => fs.access(path.join(root, "trash-file.txt")));
    assert.deepEqual(recycled.map((entry) => path.basename(entry)).sort(), ["trash-dir", "trash-file.txt"]);
  });
});
