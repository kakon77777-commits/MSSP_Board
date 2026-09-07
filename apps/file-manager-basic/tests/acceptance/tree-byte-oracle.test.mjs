import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { materializeFixture, validateFixtureManifest } from "./support/materialize-fixture.mjs";
import { verifyTree } from "./support/tree-byte-oracle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "fixtures", "fixture-manifest.json"), "utf8"));
const scratchPrefix = "D:/Ai/work together/.mssp-app2-acceptance-";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();

function withFixture(run) {
  const root = mkdtempSync(scratchPrefix);
  const normalized = path.resolve(root).replaceAll("\\", "/");
  assert.ok(normalized.startsWith("D:/Ai/work together/.mssp-app2-acceptance-"));
  try {
    materializeFixture(root, manifest);
    return run(root);
  } finally {
    const resolved = path.resolve(root).replaceAll("\\", "/");
    assert.ok(resolved.startsWith("D:/Ai/work together/.mssp-app2-acceptance-"));
    rmSync(root, { recursive: true, force: true });
  }
}

test("the independent oracle accepts the exact pinned fixture", () => {
  withFixture((root) => {
    const result = verifyTree(root, manifest);
    assert.deepEqual(result, {
      status: "match",
      checkedEntries: 30,
      mismatches: [],
    });
  });
});

test("the fixture manifest is an exact projection of the approved preregistration", () => {
  const preregPath = path.resolve(
    here,
    "../../../../slices/02-file-manager-basic/preregistration.json",
  );
  const bytes = readFileSync(preregPath);
  assert.equal(bytes.length, 54512);
  assert.equal(
    sha256(bytes),
    "20CB3AD070242C5FE0C4047E05A59B2E05993F258B35A11B0032503997F13740",
  );
  const preregistration = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(manifest.entries, preregistration.fixture_contract.entries);
});

test("the independent oracle rejects one changed byte", () => {
  withFixture((root) => {
    const target = path.join(root, "copy-file.bin");
    const bytes = readFileSync(target);
    bytes[0] ^= 0xff;
    writeFileSync(target, bytes);
    const result = verifyTree(root, manifest);
    assert.equal(result.status, "mismatch");
    assert.deepEqual(result.mismatches.map((item) => item.kind), ["sha256"]);
    assert.equal(result.mismatches[0].path, "copy-file.bin");
  });
});

test("the independent oracle rejects an unexpected path", () => {
  withFixture((root) => {
    writeFileSync(path.join(root, "unexpected.txt"), "not in manifest\n", "utf8");
    const result = verifyTree(root, manifest);
    assert.equal(result.status, "mismatch");
    assert.deepEqual(result.mismatches, [{
      path: "unexpected.txt",
      kind: "unexpected",
      expected: null,
      actual: "file",
    }]);
  });
});

test("the oracle and fixture helper import no product module", () => {
  const source = [
    readFileSync(path.join(here, "support", "materialize-fixture.mjs"), "utf8"),
    readFileSync(path.join(here, "support", "tree-byte-oracle.mjs"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /(?:^|["'`])(?:\.\.\/){3,}src\//m);
  assert.doesNotMatch(source, /apps\/file-manager-basic\/src\//);
});

test("fixture validation rejects paths or rows that could escape or alias", () => {
  const base = structuredClone(manifest);
  const invalid = [
    ["parent traversal", { ...base.entries[0], path: "../outside" }],
    ["absolute path", { ...base.entries[0], path: "D:/outside" }],
    ["backslash path", { ...base.entries[0], path: "nav\\outside" }],
    ["dot segment", { ...base.entries[0], path: "nav/./outside" }],
    ["unknown kind", { ...base.entries[0], kind: "other" }],
  ];
  for (const [name, row] of invalid) {
    const candidate = structuredClone(base);
    candidate.entries[0] = row;
    assert.throws(() => validateFixtureManifest(candidate), { name: "TypeError" }, name);
  }
  const duplicate = structuredClone(base);
  duplicate.entries[1].path = duplicate.entries[0].path;
  assert.throws(() => validateFixtureManifest(duplicate), { name: "TypeError" });
});
