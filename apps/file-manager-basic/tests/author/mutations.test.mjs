import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

async function load(name) {
  const file = path.join(app, "dist", "tms", name);
  assert.ok(existsSync(file), `RED: built TMS module is absent: ${name}`);
  return import(`${pathToFileURL(file).href}?${Date.now()}-${Math.random()}`);
}

class FakeFilesystem {
  constructor() {
    this.subjects = new Map([
      ["R/a.txt", { kind: "file", byteLength: 1, isReparse: false }],
      ["R/b.txt", { kind: "file", byteLength: 2, isReparse: false }],
      ["R/folder", { kind: "directory", byteLength: null, isReparse: false }],
      ["R/dest", { kind: "directory", byteLength: null, isReparse: false }],
      ["R/conflict.txt", { kind: "file", byteLength: 8, isReparse: false }],
      ["R/link", { kind: "reparse", byteLength: null, isReparse: true }],
    ]);
    this.calls = [];
    this.fail = new Set();
  }
  join(parent, name) { return `${parent}/${name}`; }
  parent(subject) { return subject.slice(0, subject.lastIndexOf("/")); }
  baseName(subject) { return subject.split("/").at(-1); }
  same(left, right) { return left === right; }
  isWithin(root, candidate) { return candidate === root || candidate.startsWith(`${root}/`); }
  async realpath(subject) { return subject; }
  async exists(subject) { return this.subjects.has(subject); }
  async lstat(subject) {
    const value = this.subjects.get(subject);
    if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { ...value };
  }
  async readDirectory() { return []; }
  async createDirectory(subject) {
    this.calls.push(["create", subject]);
    if (this.fail.has(subject)) throw new Error("create failed");
    this.subjects.set(subject, { kind: "directory", byteLength: null, isReparse: false });
  }
  async rename(from, to) {
    this.calls.push(["rename", from, to]);
    if (this.fail.has(from)) throw new Error("rename failed");
    const value = this.subjects.get(from);
    this.subjects.delete(from); this.subjects.set(to, value);
  }
  async copy(from, to) {
    this.calls.push(["copy", from, to]);
    if (this.fail.has(from)) throw new Error("copy failed");
    this.subjects.set(to, { ...this.subjects.get(from) });
  }
  async move(from, to) { return this.rename(from, to); }
}

class FakeSession {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.publishCount = 0;
    this.nextUnavailable = false;
  }
  mutationContext() {
    return {
      rootPath: "R", directoryPath: "R", snapshot: this.snapshot, evidencePath: "stubbed",
    };
  }
  async publishAfterMutation() {
    this.publishCount += 1;
    if (this.nextUnavailable) {
      return { state: "unavailable", snapshot: null, lastPublishedGeneration: this.snapshot.generation, code: "snapshot_read_failed" };
    }
    this.snapshot = { ...this.snapshot, generation: this.snapshot.generation + 1 };
    return { state: "current", snapshot: this.snapshot };
  }
}

class FakeRecycle {
  constructor(filesystem) { this.filesystem = filesystem; this.calls = []; this.fail = new Set(); }
  async recycle(subject) {
    this.calls.push(subject);
    if (this.fail.has(subject)) throw new Error("recycle failed");
    this.filesystem.subjects.delete(subject);
  }
}

async function setup() {
  const [{ BatchOperationOrchestrator }, { EntryIdRegistry }, { validateSingleSegmentName }] = await Promise.all([
    load("batch-operation-orchestrator.js"), load("entry-id-registry.js"), load("single-segment-name-validator.js"),
  ]);
  const filesystem = new FakeFilesystem();
  let counter = 0;
  const identities = new EntryIdRegistry(() => `m${++counter}`);
  identities.beginGeneration(1);
  const byPath = {};
  for (const [subject, stat] of filesystem.subjects) byPath[subject] = identities.issue(subject, stat.kind);
  const snapshot = {
    schema: "fm.directory-snapshot/v1",
    root: { rootId: "root:r", displayName: "R" },
    generation: 1,
    directoryId: null,
    parentEntryId: null,
    completeness: "complete",
    entries: Object.entries(byPath).map(([subject, entryId]) => ({
      entryId, name: subject.split("/").at(-1), kind: filesystem.subjects.get(subject).kind,
      byteLength: filesystem.subjects.get(subject).byteLength,
    })),
    observationErrors: [],
  };
  filesystem.subjects.set("R/hidden.txt", { kind: "file", byteLength: 1, isReparse: false });
  filesystem.subjects.set("R/hidden-dir", { kind: "directory", byteLength: null, isReparse: false });
  const hiddenFileId = identities.issue("R/hidden.txt", "file");
  const hiddenDirectoryId = identities.issue("R/hidden-dir", "directory");
  const session = new FakeSession(snapshot);
  const recycle = new FakeRecycle(filesystem);
  const orchestrator = new BatchOperationOrchestrator({
    filesystem, recycle, identities, session, validateName: validateSingleSegmentName,
  });
  const item = (subject, ordinal = 0) => ({ ordinal, submittedEntryId: byPath[subject] });
  return { orchestrator, filesystem, session, recycle, byPath, hiddenFileId, hiddenDirectoryId, item };
}

test("create validates name in main-owned logic and publishes only after success", async () => {
  const { orchestrator, filesystem, session } = await setup();
  const refused = await orchestrator.createDirectory(1, null, "../escape");
  assert.equal(refused.status, "refused");
  assert.equal(refused.code, "invalid_name");
  assert.equal(filesystem.calls.length, 0);
  assert.equal(refused.snapshot.state, "unchanged");
  const accepted = await orchestrator.createDirectory(1, null, "new-folder");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.createdName, "new-folder");
  assert.equal(accepted.snapshot.state, "current");
  assert.deepEqual(filesystem.calls, [["create", "R/new-folder"]]);
  assert.equal(session.publishCount, 1);
});

test("duplicate, stale and reparse inputs refuse the whole request before mutation", async () => {
  const { orchestrator, filesystem, item } = await setup();
  const duplicate = item("R/a.txt");
  const result = await orchestrator.copy(1, [duplicate, { ...duplicate, ordinal: 1 }], null);
  assert.equal(result.overallStatus, "refused");
  assert.deepEqual(result.outcomes.map((outcome) => outcome.code), ["duplicate_entry_id", "duplicate_entry_id"]);
  assert.equal(filesystem.calls.length, 0);
  const stale = await orchestrator.trash(0, [item("R/a.txt")]);
  assert.equal(stale.overallStatus, "refused");
  assert.equal(stale.outcomes[0].code, "stale_generation");
  const reparse = await orchestrator.move(1, [item("R/link")], null);
  assert.equal(reparse.overallStatus, "refused");
  assert.equal(reparse.outcomes[0].code, "reparse_refused");
  assert.equal(filesystem.calls.length, 0);
});

test("rename conflict refuses without overwriting the sentinel", async () => {
  const { orchestrator, filesystem, item } = await setup();
  const result = await orchestrator.rename(1, [item("R/a.txt")], "conflict.txt");
  assert.equal(result.overallStatus, "refused");
  assert.equal(result.outcomes[0].code, "conflict");
  assert.equal(filesystem.calls.length, 0);
  assert.equal(filesystem.subjects.get("R/conflict.txt").byteLength, 8);
});

test("copy preserves one outcome per ordinal and reports partial execution honestly", async () => {
  const { orchestrator, filesystem, session, byPath, item } = await setup();
  filesystem.fail.add("R/b.txt");
  const result = await orchestrator.copy(1, [item("R/a.txt", 4), item("R/b.txt", 9)], byPath["R/dest"]);
  assert.equal(result.overallStatus, "partial");
  assert.deepEqual(result.outcomes.map((outcome) => [outcome.ordinal, outcome.status]), [[4, "accepted"], [9, "failed"]]);
  assert.equal(Object.hasOwn(result.outcomes[0], "submittedEntryId"), false);
  assert.equal(Object.hasOwn(result.outcomes[1], "submittedEntryId"), false);
  assert.equal(result.outcomes[1].code, "filesystem_operation_failed");
  assert.equal(result.snapshot.state, "current");
  assert.equal(session.publishCount, 1);
});

test("successful mutation plus failed post-scan remains accepted and unavailable", async () => {
  const { orchestrator, session, byPath, item } = await setup();
  session.nextUnavailable = true;
  const result = await orchestrator.move(1, [item("R/a.txt")], byPath["R/dest"]);
  assert.equal(result.overallStatus, "accepted");
  assert.equal(result.outcomes[0].status, "accepted");
  assert.equal(result.snapshot.state, "unavailable");
  assert.equal(result.snapshot.lastPublishedGeneration, 1);
});

test("trash uses recycle port and distinguishes failure from refusal", async () => {
  const { orchestrator, recycle, item } = await setup();
  recycle.fail.add("R/b.txt");
  const failed = await orchestrator.trash(1, [item("R/b.txt")]);
  assert.equal(failed.overallStatus, "failed");
  assert.equal(failed.outcomes[0].status, "failed");
  assert.equal(failed.outcomes[0].code, "recycle_failed");
  assert.equal(failed.snapshot.state, "unchanged");
  assert.deepEqual(recycle.calls, ["R/b.txt"]);
});

test("copy to a current destination directory uses its canonical id", async () => {
  const { orchestrator, filesystem, byPath, item } = await setup();
  const result = await orchestrator.copy(1, [item("R/a.txt")], byPath["R/dest"]);
  assert.equal(result.overallStatus, "accepted");
  assert.deepEqual(filesystem.calls, [["copy", "R/a.txt", "R/dest/a.txt"]]);
});

test("current-generation cursors or hidden handles do not become mutation authority", async () => {
  const { orchestrator, filesystem, recycle, hiddenFileId, hiddenDirectoryId, item } = await setup();
  const hidden = { ordinal: 0, submittedEntryId: hiddenFileId };
  const trash = await orchestrator.trash(1, [hidden]);
  assert.equal(trash.overallStatus, "refused");
  assert.equal(trash.outcomes[0].code, "invalid_entry_id");
  assert.equal(recycle.calls.length, 0);

  const destination = await orchestrator.copy(1, [item("R/a.txt")], hiddenDirectoryId);
  assert.equal(destination.overallStatus, "refused");
  assert.equal(filesystem.calls.length, 0);

  const create = await orchestrator.createDirectory(1, hiddenDirectoryId, "unauthorized-child");
  assert.equal(create.status, "refused");
  assert.equal(create.code, "invalid_entry_id");
  assert.equal(filesystem.subjects.has("R/hidden-dir/unauthorized-child"), false);
});
