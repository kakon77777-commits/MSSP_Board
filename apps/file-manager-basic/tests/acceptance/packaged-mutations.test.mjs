import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  launchPackagedFixture,
  performAndRead,
  selectEntry,
} from "./support/packaged-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function pinnedFile(relative) {
  const entry = manifest.entries.find((candidate) => candidate.path === relative);
  assert.equal(entry?.kind, "file", `missing pinned file ${relative}`);
  return entry;
}

function assertPinnedFile(root, observedRelative, expectedRelative = observedRelative) {
  const expected = pinnedFile(expectedRelative);
  const bytes = readFileSync(path.join(root, ...observedRelative.split("/")));
  assert.equal(bytes.length, expected.bytes);
  assert.equal(hash(bytes), expected.sha256);
}

async function setNameAndRun(page, control, name) {
  await page.locator("#name-input").fill(name);
  return performAndRead(page, () => page.locator(control).click());
}

async function pinDestination(page, name) {
  await page.locator("#pin-target").selectOption({ label: name });
  const result = await performAndRead(
    page,
    () => page.locator("#set-destination").click(),
  );
  assert.equal(result.operation, "set-destination");
  assert.equal(result.status, "accepted");
  assert.equal(result.snapshot.state, "current");
  assert.equal(result.snapshot.snapshot.destinationProjection.state, "current");
  assert.equal(result.snapshot.snapshot.destinationProjection.displayName, name);
  return result;
}

async function runSelectedMutation(page, name, control) {
  const selection = await selectEntry(page, name);
  assert.equal(selection.status, "accepted");
  return performAndRead(page, () => page.locator(control).click());
}

test("FM-CREATE-DIRECTORY creates one directory and refuses invalid names without mutation", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    const selected = await chooseRoot(page);
    assert.equal(selected.snapshot.generation, 1);

    const created = await setNameAndRun(page, "#create-directory", "created-folder");
    assert.equal(created.status, "accepted");
    assert.equal(created.snapshot.state, "current");
    assert.equal(created.snapshot.snapshot.generation, 2);
    assert.equal(existsSync(path.join(root, "created-folder")), true);
    assert.equal(lstatSync(path.join(root, "created-folder")).isDirectory(), true);

    for (const { name, code } of [
      { name: "", code: "invalid_name" },
      { name: "copy-file.bin", code: "conflict" },
      { name: "CON", code: "invalid_name" },
      { name: "bad:name", code: "invalid_name" },
      { name: "bad/name", code: "invalid_name" },
    ]) {
      const refused = await setNameAndRun(page, "#create-directory", name);
      assert.equal(refused.status, "refused", name);
      assert.equal(refused.code, code, name);
      assert.equal(refused.snapshot.state, "unchanged", name);
      assert.equal(refused.snapshot.snapshot.generation, 2, name);
    }
    const nul = await page.evaluate(() => window.fileManager.createDirectory(2, null, "bad\0name"));
    assert.equal(nul.status, "refused");
    assert.equal(nul.code, "invalid_name");
    assert.equal(nul.snapshot.state, "unchanged");
    assert.equal(nul.snapshot.snapshot.generation, 2);
  } finally {
    await harness.close();
  }
});

test("FM-RENAME preserves bytes and conflict/stale requests leave both sentinels unchanged", async () => {
  {
    const harness = await launchPackagedFixture(manifest);
    const { page, root } = harness;
    try {
      await chooseRoot(page);
      await selectEntry(page, "rename-me.txt");
      const renamed = await setNameAndRun(page, "#rename-entry", "renamed.txt");
      assert.equal(renamed.overallStatus, "accepted");
      assert.equal(renamed.snapshot.state, "current");
      assert.equal(renamed.snapshot.snapshot.generation, 2);
      assert.equal(existsSync(path.join(root, "rename-me.txt")), false);
      assertPinnedFile(root, "renamed.txt", "rename-me.txt");
    } finally {
      await harness.close();
    }
  }

  {
    const harness = await launchPackagedFixture(manifest);
    const { page, root } = harness;
    try {
      const selected = await chooseRoot(page);
      const source = selected.snapshot.entries.find((entry) => entry.name === "rename-me.txt");
      await selectEntry(page, "rename-me.txt");
      const conflict = await setNameAndRun(page, "#rename-entry", "rename-conflict.txt");
      assert.equal(conflict.overallStatus, "refused");
      assert.deepEqual(conflict.outcomes.map((outcome) => outcome.code), ["conflict"]);
      assert.equal(conflict.snapshot.state, "unchanged");
      assert.equal(conflict.snapshot.snapshot.generation, 1);
      assertPinnedFile(root, "rename-me.txt");
      assertPinnedFile(root, "rename-conflict.txt");

      const refreshed = await performAndRead(page, () => page.locator("#refresh").click());
      assert.equal(refreshed.snapshot.snapshot.generation, 2);
      const stale = await page.evaluate(
        ({ entryId }) => window.fileManager.renameEntries(
          1,
          [{ ordinal: 0, submittedEntryId: entryId }],
          "stale-renamed.txt",
        ),
        { entryId: source.entryId },
      );
      assert.equal(stale.overallStatus, "refused");
      assert.deepEqual(stale.outcomes.map((outcome) => outcome.code), ["stale_generation"]);
      assert.equal(stale.snapshot.state, "unchanged");
      assert.equal(stale.snapshot.snapshot.generation, 2);
      assertPinnedFile(root, "rename-me.txt");
      assert.equal(existsSync(path.join(root, "stale-renamed.txt")), false);
    } finally {
      await harness.close();
    }
  }
});

for (const scenario of [
  {
    id: "FM-COPY-FILE",
    source: "copy-file.bin",
    destination: "dest-copy",
    control: "#copy-entries",
    expected: "dest-copy/copy-file.bin",
    sourceRemains: true,
  },
  {
    id: "FM-MOVE-FILE",
    source: "move-file.txt",
    destination: "dest-move",
    control: "#move-entries",
    expected: "dest-move/move-file.txt",
    sourceRemains: false,
  },
]) {
  test(`${scenario.id} uses one GUI batch and preserves exact bytes`, async () => {
    const harness = await launchPackagedFixture(manifest);
    const { page, root } = harness;
    try {
      await chooseRoot(page);
      const pinned = await pinDestination(page, scenario.destination);
      const before = pinned.snapshot.snapshot.generation;
      const result = await runSelectedMutation(page, scenario.source, scenario.control);
      assert.equal(result.overallStatus, "accepted");
      assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["accepted"]);
      assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["accepted"]);
      assert.equal(result.snapshot.state, "current");
      assert.equal(result.snapshot.snapshot.generation, before + 1);
      assertPinnedFile(root, scenario.expected, scenario.source);
      assert.deepEqual(readdirSync(path.join(root, scenario.destination)), [path.basename(scenario.expected)]);
      assert.equal(existsSync(path.join(root, scenario.source)), scenario.sourceRemains);
      if (scenario.sourceRemains) assertPinnedFile(root, scenario.source);
    } finally {
      await harness.close();
    }
  });
}

for (const scenario of [
  {
    id: "FM-COPY-DIRECTORY",
    source: "copy-dir",
    destination: "dest-copy",
    control: "#copy-entries",
    expectedRoot: "dest-copy/copy-dir",
    leavesSource: true,
    expectedFiles: [
      "nested/a.txt",
      "nested/deeper/b.bin",
    ],
    expectedDirectories: ["empty", "nested", "nested/deeper"],
    expectedListings: {
      "": ["empty", "nested"],
      "empty": [],
      "nested": ["a.txt", "deeper"],
      "nested/deeper": ["b.bin"],
    },
  },
  {
    id: "FM-MOVE-DIRECTORY",
    source: "move-dir",
    destination: "dest-move",
    control: "#move-entries",
    expectedRoot: "dest-move/move-dir",
    leavesSource: false,
    expectedFiles: ["nested.txt"],
    expectedDirectories: [],
    expectedListings: { "": ["nested.txt"] },
  },
]) {
  test(`${scenario.id} transfers the exact nested tree in one GUI command`, async () => {
    const harness = await launchPackagedFixture(manifest);
    const { page, root } = harness;
    try {
      await chooseRoot(page);
      const pinned = await pinDestination(page, scenario.destination);
      const before = pinned.snapshot.snapshot.generation;
      const started = performance.now();
      const result = await runSelectedMutation(page, scenario.source, scenario.control);
      const elapsedMs = performance.now() - started;
      assert.equal(result.overallStatus, "accepted");
      assert.equal(result.snapshot.state, "current");
      assert.equal(result.snapshot.snapshot.generation, before + 1);
      assert.equal(elapsedMs < 30_000, true, `single GUI batch exceeded hard cap: ${elapsedMs}ms`);
      for (const directory of scenario.expectedDirectories) {
        assert.equal(existsSync(path.join(root, scenario.expectedRoot, ...directory.split("/"))), true);
      }
      for (const relative of scenario.expectedFiles) {
        const sourcePath = `${scenario.source}/${relative}`;
        assertPinnedFile(root, `${scenario.expectedRoot}/${relative}`, sourcePath);
        if (scenario.leavesSource) assertPinnedFile(root, sourcePath);
      }
      for (const [relative, names] of Object.entries(scenario.expectedListings)) {
        const directory = relative === ""
          ? path.join(root, scenario.expectedRoot)
          : path.join(root, scenario.expectedRoot, ...relative.split("/"));
        assert.deepEqual(readdirSync(directory).sort((left, right) => left.localeCompare(right)), names);
      }
      assert.equal(existsSync(path.join(root, scenario.source)), scenario.leavesSource);
    } finally {
      await harness.close();
    }
  });
}

for (const scenario of [
  {
    id: "FM-COPY-CONFLICT",
    source: "copy-file.bin",
    destination: "dest-copy-conflict",
    control: "#copy-entries",
    sentinel: "dest-copy-conflict/copy-file.bin",
  },
  {
    id: "FM-MOVE-CONFLICT",
    source: "move-file.txt",
    destination: "dest-move-conflict",
    control: "#move-entries",
    sentinel: "dest-move-conflict/move-file.txt",
  },
]) {
  test(`${scenario.id} refuses different-byte overwrite and leaves source and sentinel exact`, async () => {
    const harness = await launchPackagedFixture(manifest);
    const { page, root } = harness;
    try {
      await chooseRoot(page);
      const pinned = await pinDestination(page, scenario.destination);
      const before = pinned.snapshot.snapshot.generation;
      const result = await runSelectedMutation(page, scenario.source, scenario.control);
      assert.equal(result.overallStatus, "refused");
      assert.deepEqual(result.outcomes.map((outcome) => outcome.code), ["conflict"]);
      assert.equal(result.snapshot.state, "unchanged");
      assert.equal(result.snapshot.snapshot.generation, before);
      assertPinnedFile(root, scenario.source);
      assertPinnedFile(root, scenario.sentinel);
    } finally {
      await harness.close();
    }
  });
}
