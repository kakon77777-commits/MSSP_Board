import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");

async function load(relative) {
  const file = path.join(app, "dist", "tms", relative);
  assert.ok(existsSync(file), `RED: built TMS module is absent: ${relative}`);
  return import(`${pathToFileURL(file).href}?subject=${Date.now()}-${Math.random()}`);
}

test("single-segment validator accepts ordinary visible names", async () => {
  const { validateSingleSegmentName } = await load("single-segment-name-validator.js");
  assert.deepEqual(validateSingleSegmentName("folder"), { ok: true, value: "folder" });
  assert.deepEqual(validateSingleSegmentName("資料 01"), { ok: true, value: "資料 01" });
  assert.deepEqual(validateSingleSegmentName("a.b"), { ok: true, value: "a.b" });
});

test("single-segment validator rejects path authority and Windows hazards", async () => {
  const { validateSingleSegmentName } = await load("single-segment-name-validator.js");
  for (const value of ["", ".", "..", "a/b", "a\\b", "C:\\root", "name:stream", "nul\0x", "tail.", "tail ", "CON", "con.txt", "LPT1", 42, null]) {
    const result = validateSingleSegmentName(value);
    assert.equal(result.ok, false, `unexpectedly accepted ${JSON.stringify(value)}`);
    assert.ok(result.code === "invalid_name" || result.code === "invalid_argument");
  }
});

test("entry ids are opaque and valid for exactly one generation", async () => {
  const { EntryIdRegistry } = await load("entry-id-registry.js");
  const ids = new EntryIdRegistry(() => "token-one");
  ids.beginGeneration(1);
  const id = ids.issue("D:\\scratch\\root\\a.txt", "file");
  assert.equal(id, "entry:token-one");
  assert.equal(id.includes("scratch"), false);
  assert.deepEqual(ids.resolve(id, 1), {
    entryId: id,
    canonicalPath: "D:\\scratch\\root\\a.txt",
    generation: 1,
    kind: "file",
  });
  assert.equal(ids.resolve(id, 2), null);
  assert.equal(ids.resolve("entry:unknown", 1), null);
});

test("same path is stable within one snapshot and changes across publications", async () => {
  const { EntryIdRegistry } = await load("entry-id-registry.js");
  const tokens = ["first", "second"];
  const ids = new EntryIdRegistry(() => tokens.shift());
  ids.beginGeneration(7);
  const first = ids.issue("D:\\scratch\\root\\same.txt", "file");
  assert.equal(ids.issue("D:\\scratch\\root\\same.txt", "file"), first);
  ids.beginGeneration(8);
  const second = ids.issue("D:\\scratch\\root\\same.txt", "file");
  assert.notEqual(second, first);
  assert.equal(ids.resolve(first, 7), null, "old generation mappings must be discarded");
  assert.equal(ids.currentGeneration(), 8);
});

test("registry rejects issue before a generation and duplicate token collisions", async () => {
  const { EntryIdRegistry } = await load("entry-id-registry.js");
  const ids = new EntryIdRegistry(() => "collision");
  assert.throws(() => ids.issue("D:\\a", "file"), /generation/i);
  ids.beginGeneration(1);
  ids.issue("D:\\a", "file");
  assert.throws(() => ids.issue("D:\\b", "directory"), /collision/i);
});
