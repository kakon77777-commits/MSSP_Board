import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chooseRoot,
  launchPackagedFixture,
  performAndRead,
  selectEntry,
} from "./support/packaged-harness.mjs";
import {
  withEscapeJunctionAsync,
  withUnreadableEntry,
} from "./support/dynamic-subjects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));

test("FM-SELECT-STALE refuses missing, duplicate, unknown and cross-generation identities", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page } = harness;
  try {
    const selected = await chooseRoot(page);
    const known = selected.snapshot.entries.find((entry) => entry.name === "copy-file.bin").entryId;
    const cases = [
      {
        items: [{ ordinal: 0, submittedEntryId: null }],
        code: "missing_entry_id",
      },
      {
        items: [
          { ordinal: 0, submittedEntryId: known },
          { ordinal: 1, submittedEntryId: known },
        ],
        code: "duplicate_entry_id",
      },
      {
        items: [{ ordinal: 0, submittedEntryId: "entry:unknown" }],
        code: "unknown_entry_id",
      },
    ];
    for (const scenario of cases) {
      const result = await page.evaluate(
        ({ items }) => window.fileManager.setSelection(1, items),
        { items: scenario.items },
      );
      assert.equal(result.status, "refused");
      assert.equal(result.code, "invalid_entry_id");
      assert.equal(result.currentSnapshot.generation, 1);
      assert.deepEqual(result.outcomes.map((outcome) => outcome.code),
        scenario.items.map(() => scenario.code));
    }

    const refreshed = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(refreshed.snapshot.snapshot.generation, 2);
    const crossGeneration = await page.evaluate(
      ({ entryId }) => window.fileManager.setSelection(1, [{ ordinal: 0, submittedEntryId: entryId }]),
      { entryId: known },
    );
    assert.equal(crossGeneration.status, "refused");
    assert.equal(crossGeneration.code, "stale_generation");
    assert.deepEqual(crossGeneration.outcomes.map((outcome) => outcome.code), ["cross_generation_entry_id"]);
    assert.equal(crossGeneration.currentSnapshot.generation, 2);
  } finally {
    await harness.close();
  }
});

test("FM-VIEW-PARTIAL reports a proven unreadable member instead of a false complete view", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    await chooseRoot(page);
    const observed = await withUnreadableEntry(
      path.join(root, "partial", "unreadable.bin"),
      path.join(root, "partial", "ok.bin"),
      async ({ proof }) => {
        assert.equal(proof.preconditionState, "proven");
        return performAndRead(
          page,
          () => page.locator('#entries li[data-name="partial"] button.entry-open').click(),
        );
      },
    );
    assert.equal(observed.cleanupState, "acl-restored");
    assert.equal(observed.value.status, "accepted");
    assert.equal(observed.value.snapshot.state, "current");
    assert.equal(observed.value.snapshot.snapshot.completeness, "partial");
    assert.deepEqual(observed.value.snapshot.snapshot.observationErrors,
      [{ entryId: null, code: "entry_observation_failed" }]);
    assert.equal(await page.locator("#completeness").textContent(), "partial");
  } finally {
    await harness.close();
  }
});

test("FM-NAV-ESCAPE and reparse mutation use distinct typed refusals without traversal", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    await chooseRoot(page);
    const observed = await withEscapeJunctionAsync(root, randomUUID(), async ({ targetPath, proof }) => {
      assert.equal(proof.preconditionState, "proven");
      const refreshed = await performAndRead(page, () => page.locator("#refresh").click());
      assert.equal(refreshed.snapshot.state, "current");
      const generation = refreshed.snapshot.snapshot.generation;
      const junction = refreshed.snapshot.snapshot.entries.find((entry) => entry.name === "escape-junction");
      assert.equal(junction.kind, "reparse");

      for (const malformed of ["..", "D:\\outside", "name:stream", "CON", "bad\0id"]) {
        const result = await page.evaluate(
          ({ currentGeneration, entryId }) => window.fileManager.navigate(currentGeneration, entryId),
          { currentGeneration: generation, entryId: malformed },
        );
        assert.equal(result.status, "refused", malformed);
        assert.equal(result.code, "invalid_entry_id", malformed);
        assert.equal(result.snapshot.state, "unchanged", malformed);
        assert.equal(result.snapshot.snapshot.generation, generation, malformed);
      }

      const navigation = await page.evaluate(
        ({ currentGeneration, entryId }) => window.fileManager.navigate(currentGeneration, entryId),
        { currentGeneration: generation, entryId: junction.entryId },
      );
      assert.equal(navigation.status, "refused");
      assert.equal(navigation.code, "reparse_refused");
      assert.equal(navigation.snapshot.state, "unchanged");
      assert.equal(navigation.snapshot.snapshot.generation, generation);

      const selection = await selectEntry(page, "escape-junction");
      assert.equal(selection.status, "accepted");
      const mutation = await performAndRead(page, () => page.locator("#trash-entries").click());
      assert.equal(mutation.overallStatus, "refused");
      assert.deepEqual(mutation.outcomes.map((outcome) => outcome.code), ["reparse_refused"]);
      assert.equal(mutation.snapshot.state, "unchanged");
      assert.equal(mutation.snapshot.snapshot.generation, generation);
      return { targetPath };
    });
    assert.equal(observed.cleanupState, "restored");
  } finally {
    await harness.close();
  }
});

test("FM-MOVE-CONFLICT refuses a stale projected destination identity", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    await chooseRoot(page);
    await page.locator("#pin-target").selectOption({ label: "dest-move" });
    const pinned = await performAndRead(page, () => page.locator("#set-destination").click());
    const staleDestination = pinned.snapshot.snapshot.destinationProjection.entryId;
    assert.equal(pinned.snapshot.snapshot.generation, 2);

    const refreshed = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(refreshed.snapshot.snapshot.generation, 3);
    assert.notEqual(refreshed.snapshot.snapshot.destinationProjection.entryId, staleDestination);
    const source = refreshed.snapshot.snapshot.entries.find((entry) => entry.name === "move-file.txt");
    const result = await page.evaluate(
      ({ generation, entryId, destinationDirectoryId }) => window.fileManager.moveEntries(
        generation,
        [{ ordinal: 0, submittedEntryId: entryId }],
        destinationDirectoryId,
      ),
      { generation: 3, entryId: source.entryId, destinationDirectoryId: staleDestination },
    );
    assert.equal(result.overallStatus, "refused");
    assert.deepEqual(result.outcomes.map((outcome) => outcome.code), ["invalid_entry_id"]);
    assert.equal(result.snapshot.state, "unchanged");
    assert.equal(result.snapshot.snapshot.generation, 3);
    assert.equal(existsSync(path.join(root, "move-file.txt")), true);
    assert.equal(existsSync(path.join(root, "dest-move", "move-file.txt")), false);
  } finally {
    await harness.close();
  }
});

test("FM-TRASH-REFUSE rejects stale and unknown identities without mutation", async () => {
  const harness = await launchPackagedFixture(manifest);
  const { page, root } = harness;
  try {
    const selected = await chooseRoot(page);
    const old = selected.snapshot.entries.find((entry) => entry.name === "trash-file.txt");
    const refreshed = await performAndRead(page, () => page.locator("#refresh").click());
    assert.equal(refreshed.snapshot.snapshot.generation, 2);

    const stale = await page.evaluate(
      ({ entryId }) => window.fileManager.trashEntries(1, [{ ordinal: 0, submittedEntryId: entryId }]),
      { entryId: old.entryId },
    );
    assert.equal(stale.overallStatus, "refused");
    assert.deepEqual(stale.outcomes.map((outcome) => outcome.code), ["stale_generation"]);
    assert.equal(stale.snapshot.state, "unchanged");
    assert.equal(stale.snapshot.snapshot.generation, 2);

    const unknown = await page.evaluate(() => window.fileManager.trashEntries(
      2,
      [{ ordinal: 0, submittedEntryId: "entry:outside-root" }],
    ));
    assert.equal(unknown.overallStatus, "refused");
    assert.deepEqual(unknown.outcomes.map((outcome) => outcome.code), ["invalid_entry_id"]);
    assert.equal(unknown.snapshot.state, "unchanged");
    assert.equal(unknown.snapshot.snapshot.generation, 2);
    assert.equal(existsSync(path.join(root, "trash-file.txt")), true);
  } finally {
    await harness.close();
  }
});
