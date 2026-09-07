import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const record = JSON.parse(fs.readFileSync(
  path.join(here, "products", "01-text-editor-basic.json"), "utf8"));

test("portfolio owners are variable semantic role records rather than App-1 fixed fields", () => {
  assert.ok(Array.isArray(record.owners), "RED: owners is still the App-1-specific object");
  assert.equal(record.owners.length, 3);
  assert.deepEqual(record.owners.map((owner) => Object.keys(owner).sort()), [
    ["role", "speaker"], ["role", "speaker"], ["role", "speaker"],
  ]);
  assert.equal(new Set(record.owners.map((owner) => owner.role)).size, 3);
  assert.ok(record.owners.every((owner) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(owner.role)));
  assert.deepEqual(new Set(record.owners.map((owner) => owner.speaker)),
    new Set(["Elenchos", "Metron", "Pragma"]));
});
