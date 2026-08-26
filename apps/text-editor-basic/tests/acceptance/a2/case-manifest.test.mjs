import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..", "..", "..");
const slice = path.join(app, "..", "..", "slices", "01-text-editor-basic");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8"));
const prereg = JSON.parse(fs.readFileSync(path.join(slice, "preregistration.json"), "utf8"));

const EXPECTED_IDS = [
  "A2-ENC-OPEN-LF",
  "A2-ENC-OPEN-CRLF",
  "A2-ENC-OPEN-BOM",
  "A2-REFUSAL-NOT-UTF8",
  "A2-REFUSAL-UNREADABLE",
  "A2-REFUSAL-UNWRITABLE",
  "A2-REFUSAL-PATH-REJECTED",
  "A2-ENC-FAILURE-STATE-UNCHANGED",
  "A2-ENC-VISIBILITY-HANDSHAKE",
];

test("Pragma A2 case manifest is bound to the agreed core and ready baseline", () => {
  assert.equal(manifest.schema, "mssp.a2-acceptance-cases/v1");
  assert.equal(manifest.core_sha256,
    "8656A872133D826CF0E08B7AFAE3EFDBAC0A83F6CCB427F507F38B6681D2D05F");
  assert.equal(manifest.source_baseline, "43617b2d42b9141d41a881fcc6d673b19b752102");
  assert.equal(manifest.owner, "Pragma");
  assert.match(manifest.independence, /must not author or modify/);
});

test("every Pragma-owned A2 case has one stable unique ID and a two-sided subject", () => {
  const ids = manifest.cases.map(({ id }) => id);
  assert.deepEqual(ids.toSorted(), EXPECTED_IDS.toSorted());
  assert.equal(new Set(ids).size, ids.length, "duplicate acceptance case ID");
  for (const entry of manifest.cases) {
    assert.ok(entry.subject.trim(), `${entry.id} has no failure subject`);
    assert.ok(entry.positive.trim(), `${entry.id} has no allowed positive control`);
    assert.ok(entry.attack.trim(), `${entry.id} has no rejected/mutation case`);
  }
});

test("acceptance cases bind only to capabilities in the fixed 11-item denominator", () => {
  const denominator = new Set([
    ...prereg.required_capabilities.generic_infra,
    ...prereg.required_capabilities.domain,
  ]);
  assert.equal(denominator.size, 11);
  for (const { id, capability } of manifest.cases) {
    assert.ok(denominator.has(capability), `${id} cites non-denominator capability ${capability}`);
    assert.equal(typeof prereg.capability_acceptance_map[capability], "string",
      `${id} cites a capability without a preregistered acceptance row`);
  }
});
