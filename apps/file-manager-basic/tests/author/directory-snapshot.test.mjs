import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

async function modules() {
  const builderFile = path.join(app, "dist", "tms", "directory-snapshot-builder.js");
  const idsFile = path.join(app, "dist", "tms", "entry-id-registry.js");
  assert.ok(existsSync(builderFile), "RED: directory-snapshot-builder.js is absent");
  const stamp = `${Date.now()}-${Math.random()}`;
  const [{ DirectorySnapshotBuilder }, { EntryIdRegistry }] = await Promise.all([
    import(`${pathToFileURL(builderFile).href}?${stamp}`),
    import(`${pathToFileURL(idsFile).href}?${stamp}`),
  ]);
  return { DirectorySnapshotBuilder, EntryIdRegistry };
}

class FakeFilesystem {
  constructor(entries, stats) {
    this.entries = entries;
    this.stats = stats;
  }
  async readDirectory(directory) {
    const value = this.entries[directory];
    if (value instanceof Error) throw value;
    return [...value];
  }
  async lstat(subject) {
    const value = this.stats[subject];
    if (value instanceof Error) throw value;
    if (!value) throw new Error(`missing fake stat ${subject}`);
    return { ...value };
  }
  join(parent, name) { return `${parent}/${name}`; }
  parent(subject) { return subject.slice(0, subject.lastIndexOf("/")); }
  same(left, right) { return left === right; }
}

function input(overrides = {}) {
  return {
    rootPath: "R",
    rootId: "root:opaque",
    rootDisplayName: "Pinned Root",
    directoryPath: "R",
    generation: 1,
    evidencePath: "stubbed",
    ...overrides,
  };
}

test("complete root snapshot publishes sorted typed entries and no filesystem path", async () => {
  const { DirectorySnapshotBuilder, EntryIdRegistry } = await modules();
  const filesystem = new FakeFilesystem({ R: ["z-dir", "a.txt", "link"] }, {
    "R/a.txt": { kind: "file", byteLength: 4, isReparse: false },
    "R/z-dir": { kind: "directory", byteLength: null, isReparse: false },
    "R/link": { kind: "directory", byteLength: null, isReparse: true },
  });
  let counter = 0;
  const builder = new DirectorySnapshotBuilder(filesystem, new EntryIdRegistry(() => `t${++counter}`));
  const result = await builder.build(input());
  assert.equal(result.status, "observed");
  assert.equal(result.evidencePath, "stubbed");
  assert.deepEqual(result.snapshot.snapshot.root, { rootId: "root:opaque", displayName: "Pinned Root" });
  assert.equal(result.snapshot.snapshot.directoryId, null);
  assert.equal(result.snapshot.snapshot.parentEntryId, null);
  assert.equal(result.snapshot.snapshot.completeness, "complete");
  assert.deepEqual(result.snapshot.snapshot.destinationProjection, { state: "none" });
  assert.deepEqual(result.snapshot.snapshot.entries.map(({ name, kind, byteLength }) => ({ name, kind, byteLength })), [
    { name: "a.txt", kind: "file", byteLength: 4 },
    { name: "link", kind: "reparse", byteLength: null },
    { name: "z-dir", kind: "directory", byteLength: null },
  ]);
  assert.ok(result.snapshot.snapshot.entries.every((entry) => entry.entryId.startsWith("entry:t")));
  assert.equal(JSON.stringify(result).includes("R/a.txt"), false, "renderer-safe DTO leaked a path");
});

test("one entry observation failure produces partial rather than false-empty complete", async () => {
  const { DirectorySnapshotBuilder, EntryIdRegistry } = await modules();
  const filesystem = new FakeFilesystem({ R: ["ok.bin", "unreadable.bin"] }, {
    "R/ok.bin": { kind: "file", byteLength: 8, isReparse: false },
    "R/unreadable.bin": new Error("access denied"),
  });
  const builder = new DirectorySnapshotBuilder(filesystem, new EntryIdRegistry(() => crypto.randomUUID()));
  const result = await builder.build(input({ generation: 2 }));
  assert.equal(result.status, "observed");
  assert.equal(result.snapshot.snapshot.completeness, "partial");
  assert.deepEqual(result.snapshot.snapshot.entries.map((entry) => entry.name), ["ok.bin"]);
  assert.deepEqual(result.snapshot.snapshot.observationErrors, [
    { entryId: null, code: "entry_observation_failed" },
  ]);
});

test("directory read failure is typed unavailable and publishes nothing", async () => {
  const { DirectorySnapshotBuilder, EntryIdRegistry } = await modules();
  const ids = new EntryIdRegistry(() => "unused");
  ids.beginGeneration(1);
  const builder = new DirectorySnapshotBuilder(new FakeFilesystem({ R: new Error("gone") }, {}), ids);
  const result = await builder.build(input({ generation: 2, evidencePath: "native" }));
  assert.deepEqual(result, {
    status: "failed",
    code: "snapshot_read_failed",
    snapshot: {
      state: "unavailable",
      snapshot: null,
      lastPublishedGeneration: 1,
      code: "snapshot_read_failed",
    },
    evidencePath: "native",
  });
  assert.equal(ids.currentGeneration(), 1, "failed observation must not invalidate current IDs");
});

test("nested snapshot issues current and parent cursors in the same generation", async () => {
  const { DirectorySnapshotBuilder, EntryIdRegistry } = await modules();
  const filesystem = new FakeFilesystem({ "R/a/b": [] }, {
    "R/a": { kind: "directory", byteLength: null, isReparse: false },
    "R/a/b": { kind: "directory", byteLength: null, isReparse: false },
  });
  let counter = 0;
  const ids = new EntryIdRegistry(() => `nested-${++counter}`);
  const builder = new DirectorySnapshotBuilder(filesystem, ids);
  const result = await builder.build(input({ directoryPath: "R/a/b", generation: 3 }));
  assert.equal(result.status, "observed");
  const snapshot = result.snapshot.snapshot;
  assert.ok(snapshot.directoryId);
  assert.ok(snapshot.parentEntryId);
  assert.equal(ids.resolve(snapshot.directoryId, 3).canonicalPath, "R/a/b");
  assert.equal(ids.resolve(snapshot.parentEntryId, 3).canonicalPath, "R/a");
});
