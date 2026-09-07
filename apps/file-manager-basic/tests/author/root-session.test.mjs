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

class Picker {
  constructor(results) { this.results = [...results]; }
  async chooseRoot() {
    const next = this.results.shift();
    if (next instanceof Error) throw next;
    return next;
  }
}

class FakeFilesystem {
  constructor() {
    this.entries = {
      R: ["child", "a.txt", "link"],
      "R/child": ["nested.txt"],
      S: ["other.txt"],
    };
    this.stats = {
      R: { kind: "directory", byteLength: null, isReparse: false },
      "R/child": { kind: "directory", byteLength: null, isReparse: false },
      "R/a.txt": { kind: "file", byteLength: 1, isReparse: false },
      "R/link": { kind: "reparse", byteLength: null, isReparse: true },
      "R/child/nested.txt": { kind: "file", byteLength: 2, isReparse: false },
      S: { kind: "directory", byteLength: null, isReparse: false },
      "S/other.txt": { kind: "file", byteLength: 3, isReparse: false },
      LINK: { kind: "reparse", byteLength: null, isReparse: true },
    };
  }
  join(parent, name) { return `${parent}/${name}`; }
  parent(subject) { return subject.includes("/") ? subject.slice(0, subject.lastIndexOf("/")) : subject; }
  baseName(subject) { return subject.split("/").at(-1); }
  same(left, right) { return left === right; }
  isWithin(root, candidate) { return candidate === root || candidate.startsWith(`${root}/`); }
  async lstat(subject) {
    const value = this.stats[subject];
    if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { ...value };
  }
  async readDirectory(subject) {
    if (!this.entries[subject]) throw new Error("unreadable");
    return [...this.entries[subject]];
  }
  async realpath(subject) { return subject; }
  async exists(subject) { return Boolean(this.stats[subject]); }
}

async function setup(pickerResults) {
  const [{ RootSessionController }, { DirectorySnapshotBuilder }, { EntryIdRegistry }] = await Promise.all([
    load("root-session-controller.js"),
    load("directory-snapshot-builder.js"),
    load("entry-id-registry.js"),
  ]);
  const filesystem = new FakeFilesystem();
  let entryCounter = 0;
  const identities = new EntryIdRegistry(() => `id-${++entryCounter}`);
  const snapshots = new DirectorySnapshotBuilder(filesystem, identities);
  let rootCounter = 0;
  const controller = new RootSessionController({
    picker: new Picker(pickerResults),
    filesystem,
    snapshots,
    identities,
    rootToken: () => `root-${++rootCounter}`,
  });
  return { controller, filesystem, identities };
}

test("accepted root starts at generation one; cancel and root change preserve sequence", async () => {
  const { controller } = await setup([
    { state: "selected", path: "R", evidencePath: "stubbed" },
    { state: "cancelled", evidencePath: "stubbed" },
    { state: "selected", path: "S", evidencePath: "stubbed" },
  ]);
  const first = await controller.chooseRoot();
  assert.equal(first.status, "accepted");
  assert.equal(first.snapshot.generation, 1);
  assert.deepEqual(first.snapshot.root, { rootId: "root:root-1", displayName: "R" });
  const cancelled = await controller.chooseRoot();
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(cancelled.prior.snapshot, first.snapshot);
  const changed = await controller.chooseRoot();
  assert.equal(changed.status, "accepted");
  assert.equal(changed.snapshot.generation, 2, "root change must not reset the in-process sequence");
  assert.equal(changed.snapshot.root.rootId, "root:root-2");
});

test("reparse root and missing root are refused without replacing prior state", async () => {
  const { controller } = await setup([
    { state: "selected", path: "R", evidencePath: "stubbed" },
    { state: "selected", path: "LINK", evidencePath: "stubbed" },
    { state: "selected", path: "MISSING", evidencePath: "stubbed" },
  ]);
  const first = await controller.chooseRoot();
  const reparse = await controller.chooseRoot();
  assert.deepEqual(reparse, {
    status: "refused", code: "reparse_refused", prior: { snapshot: first.snapshot }, evidencePath: "stubbed",
  });
  const missing = await controller.chooseRoot();
  assert.deepEqual(missing, {
    status: "refused", code: "path_rejected", prior: { snapshot: first.snapshot }, evidencePath: "stubbed",
  });
});

test("refresh publishes even when identical and invalidates the old entry ids", async () => {
  const { controller } = await setup([{ state: "selected", path: "R", evidencePath: "stubbed" }]);
  const selected = await controller.chooseRoot();
  const oldId = selected.snapshot.entries.find((entry) => entry.name === "a.txt").entryId;
  const refreshed = await controller.refresh();
  assert.equal(refreshed.status, "accepted");
  assert.equal(refreshed.snapshot.snapshot.generation, 2);
  const current = refreshed.snapshot.snapshot.entries.find((entry) => entry.name === "a.txt").entryId;
  assert.notEqual(current, oldId);
  const stale = await controller.setSelection(1, [{ ordinal: 0, submittedEntryId: oldId }]);
  assert.equal(stale.status, "refused");
  assert.equal(stale.outcomes[0].code, "cross_generation_entry_id");
  assert.equal(stale.currentSnapshot.generation, 2);
});

test("child and parent navigation publish snapshots; root cannot navigate above itself", async () => {
  const { controller } = await setup([{ state: "selected", path: "R", evidencePath: "stubbed" }]);
  const selected = await controller.chooseRoot();
  const child = selected.snapshot.entries.find((entry) => entry.name === "child");
  const link = selected.snapshot.entries.find((entry) => entry.name === "link");
  const escaped = await controller.navigate(1, link.entryId);
  assert.equal(escaped.status, "refused");
  assert.equal(escaped.code, "reparse_refused");
  const into = await controller.navigate(1, child.entryId);
  assert.equal(into.status, "accepted");
  assert.equal(into.snapshot.snapshot.generation, 2);
  assert.ok(into.snapshot.snapshot.directoryId);
  const cursorSelection = await controller.setSelection(2, [
    { ordinal: 0, submittedEntryId: into.snapshot.snapshot.directoryId },
  ]);
  assert.equal(cursorSelection.status, "refused", "current directory cursor is not a visible selectable entry");
  assert.equal(cursorSelection.outcomes[0].code, "unknown_entry_id");
  const parent = await controller.navigate(2, null);
  assert.equal(parent.status, "accepted");
  assert.equal(parent.snapshot.snapshot.generation, 3);
  assert.equal(parent.snapshot.snapshot.directoryId, null);
  const above = await controller.navigate(3, null);
  assert.equal(above.status, "refused");
  assert.equal(above.code, "navigate_above_root");
  assert.equal(above.snapshot.snapshot.generation, 3);
});

test("selection validates all occurrences without publishing a generation", async () => {
  const { controller } = await setup([{ state: "selected", path: "R", evidencePath: "stubbed" }]);
  const selected = await controller.chooseRoot();
  const ids = selected.snapshot.entries.map((entry) => entry.entryId);
  const accepted = await controller.setSelection(1, ids.map((entryId, ordinal) => ({ ordinal, submittedEntryId: entryId })));
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(accepted.outcomes.map((outcome) => outcome.entryId), ids);
  assert.equal(accepted.currentSnapshot.generation, 1);
  assert.equal(Object.hasOwn(accepted, "selectedEntryIds"), false);

  const duplicate = await controller.setSelection(1, [
    { ordinal: 0, submittedEntryId: ids[0] },
    { ordinal: 1, submittedEntryId: ids[0] },
  ]);
  assert.equal(duplicate.status, "refused");
  assert.deepEqual(duplicate.outcomes.map((outcome) => outcome.code), ["duplicate_entry_id", "duplicate_entry_id"]);
  assert.equal(duplicate.currentSnapshot.generation, 1);
  assert.deepEqual(duplicate.priorSelectedEntryIds, ids);

  const unknown = await controller.setSelection(1, [
    { ordinal: 0, submittedEntryId: "entry:not-issued" },
  ]);
  assert.equal(unknown.status, "refused");
  assert.equal(unknown.outcomes[0].code, "unknown_entry_id");
  assert.equal(unknown.currentSnapshot.generation, 1);
});

test("picker operational failure is distinct and no-root view is typed", async () => {
  const { controller } = await setup([new Error("picker exploded")]);
  const failed = await controller.chooseRoot();
  assert.deepEqual(failed, {
    status: "failed", code: "root_picker_failed", prior: null, evidencePath: "native",
  });
  const view = await controller.getCurrentDirectory();
  assert.equal(view.status, "failed");
  assert.equal(view.code, "root_removed");
  assert.equal(view.snapshot.state, "unavailable");
});

test("pinned destination is reissued with each publication and never becomes a source", async () => {
  const { controller } = await setup([{ state: "selected", path: "R", evidencePath: "stubbed" }]);
  const selected = await controller.chooseRoot();
  const child = selected.snapshot.entries.find((entry) => entry.name === "child");
  const link = selected.snapshot.entries.find((entry) => entry.name === "link");
  const selectedReparse = await controller.setSelection(1, [
    { ordinal: 0, submittedEntryId: link.entryId },
  ]);
  assert.equal(selectedReparse.status, "accepted", "visible reparse selection must reach mutation policy");
  const refusedPin = await controller.setDestination(1, { mode: "visible-entry", entryId: link.entryId });
  assert.equal(refusedPin.status, "refused");
  assert.equal(refusedPin.code, "reparse_refused");
  const pinned = await controller.setDestination(1, { mode: "visible-entry", entryId: child.entryId });
  assert.equal(pinned.status, "accepted");
  assert.equal(pinned.snapshot.snapshot.generation, 2);
  assert.deepEqual({
    state: pinned.snapshot.snapshot.destinationProjection.state,
    displayName: pinned.snapshot.snapshot.destinationProjection.displayName,
    isRoot: pinned.snapshot.snapshot.destinationProjection.isRoot,
  }, { state: "current", displayName: "child", isRoot: false });
  const firstDestinationId = pinned.snapshot.snapshot.destinationProjection.entryId;
  assert.notEqual(firstDestinationId, child.entryId);

  const sourceAttempt = await controller.setSelection(2, [
    { ordinal: 0, submittedEntryId: firstDestinationId },
  ]);
  assert.equal(sourceAttempt.status, "refused");

  const currentChild = pinned.snapshot.snapshot.entries.find((entry) => entry.name === "child");
  const navigated = await controller.navigate(2, currentChild.entryId);
  assert.equal(navigated.status, "accepted");
  assert.equal(navigated.snapshot.snapshot.generation, 3);
  assert.equal(navigated.snapshot.snapshot.destinationProjection.state, "current");
  assert.notEqual(navigated.snapshot.snapshot.destinationProjection.entryId, firstDestinationId);
});

test("selected-root, clear, unavailable and root-change destination states are explicit", async () => {
  const { controller, filesystem } = await setup([
    { state: "selected", path: "R", evidencePath: "stubbed" },
    { state: "selected", path: "S", evidencePath: "stubbed" },
  ]);
  await controller.chooseRoot();
  const rootPin = await controller.setDestination(1, { mode: "selected-root" });
  assert.equal(rootPin.status, "accepted");
  assert.equal(rootPin.snapshot.snapshot.destinationProjection.isRoot, true);
  const cleared = await controller.setDestination(2, { mode: "clear" });
  assert.equal(cleared.status, "accepted");
  assert.deepEqual(cleared.snapshot.snapshot.destinationProjection, { state: "none" });

  const child = cleared.snapshot.snapshot.entries.find((entry) => entry.name === "child");
  const pinned = await controller.setDestination(3, { mode: "visible-entry", entryId: child.entryId });
  filesystem.stats["R/child"] = { kind: "reparse", byteLength: null, isReparse: true };
  const refreshed = await controller.refresh();
  assert.equal(refreshed.status, "accepted");
  assert.equal(refreshed.snapshot.snapshot.completeness, "complete");
  assert.deepEqual(refreshed.snapshot.snapshot.destinationProjection, {
    state: "unavailable", entryId: null, displayName: "child", code: "destination_reparse",
  });

  const changedRoot = await controller.chooseRoot();
  assert.equal(changedRoot.status, "accepted");
  assert.deepEqual(changedRoot.snapshot.destinationProjection, { state: "none" });
  const afterRootRefresh = await controller.refresh();
  assert.equal(afterRootRefresh.status, "accepted");
  assert.deepEqual(afterRootRefresh.snapshot.snapshot.destinationProjection, { state: "none" },
    "old root destination must not reappear on the next publication");
});
