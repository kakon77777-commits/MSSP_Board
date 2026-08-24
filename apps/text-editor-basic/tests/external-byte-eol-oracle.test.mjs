// A0 / external byte and EOL oracle.
//
// These tests never import application code. They write independent raw-byte
// fixtures to disk, then require the oracle to distinguish an actual/expected
// mismatch from disagreement inside the oracle's own two read paths.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ORACLE = path.join(here, "oracles", "file-byte-eol-oracle.mjs");
const ORACLE = process.env.MSSP_EXTERNAL_ORACLE_MODULE
  ? path.resolve(process.env.MSSP_EXTERNAL_ORACLE_MODULE)
  : DEFAULT_ORACLE;

let sandbox;

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mssp-external-oracle-"));
});

after(() => {
  assert.match(path.basename(sandbox), /^mssp-external-oracle-/,
    "refusing to remove a directory not created by this test");
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function oracle() {
  try {
    return await import(pathToFileURL(ORACLE).href);
  } catch (error) {
    assert.fail(`external oracle module is unavailable: ${error.code ?? error.message}`);
  }
}

function write(name, bytes) {
  const target = path.join(sandbox, name);
  fs.writeFileSync(target, bytes);
  return target;
}

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("raw EOL profiling distinguishes LF, CRLF, lone CR, mixed, and none", async () => {
  const { profileEol } = await oracle();
  assert.deepEqual(profileEol(Buffer.from("a\nb\n", "utf8")),
    { kind: "lf", crlf: 0, lf: 2, cr: 0 });
  assert.deepEqual(profileEol(Buffer.from("a\r\nb\r\n", "utf8")),
    { kind: "crlf", crlf: 2, lf: 0, cr: 0 });
  assert.deepEqual(profileEol(Buffer.from("a\rb\r", "utf8")),
    { kind: "cr", crlf: 0, lf: 0, cr: 2 });
  assert.deepEqual(profileEol(Buffer.from("a\r\nb\nc\r", "utf8")),
    { kind: "mixed", crlf: 1, lf: 1, cr: 1 });
  assert.deepEqual(profileEol(Buffer.from("abc", "utf8")),
    { kind: "none", crlf: 0, lf: 0, cr: 0 });
});

test("a real LF file passes exact bytes and EOL", async () => {
  const { verifyFile } = await oracle();
  const bytes = Buffer.from("alpha\nbeta\n", "utf8");
  const actualPath = write("lf.txt", bytes);
  const result = verifyFile({ actualPath, expectedHex: hex(bytes), expectedEol: "lf" });

  assert.equal(result.status, "pass");
  assert.equal(result.exit_code, 0);
  assert.equal(result.readers.agree, true);
  assert.equal(result.actual.sha256, "e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee");
  assert.equal(result.actual.bom, "none");
  assert.equal(result.expected.bom, "none");
  assert.deepEqual(result.actual.eol, { kind: "lf", crlf: 0, lf: 2, cr: 0 });
  assert.deepEqual(result.issues, []);
});

test("a real CRLF file passes without newline normalization", async () => {
  const { verifyFile } = await oracle();
  const bytes = Buffer.from("alpha\r\nbeta\r\n", "utf8");
  const result = verifyFile({
    actualPath: write("crlf.txt", bytes),
    expectedHex: hex(bytes),
    expectedEol: "crlf",
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.actual.eol, { kind: "crlf", crlf: 2, lf: 0, cr: 0 });
});

test("an independently pinned 1 MiB LF artifact crosses every chunk boundary", async () => {
  const { verifyFile } = await oracle();
  const bytes = Buffer.alloc(1024 * 1024, 0x61);
  for (let index = 63; index < bytes.length; index += 64) bytes[index] = 0x0a;
  const result = verifyFile({
    actualPath: write("one-mib-lf.bin", bytes),
    expectedHex: hex(bytes),
    expectedEol: "lf",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.actual.bytes, 1048576);
  assert.equal(result.actual.sha256,
    "b296500510fd7c928cc908160ed0df61ee96123dea7987fd19fd6b22f46a0700");
  assert.equal(result.actual.bom, "none");
  assert.deepEqual(result.actual.eol, { kind: "lf", crlf: 0, lf: 16384, cr: 0 });
  assert.equal(result.readers.whole_sha256, result.readers.chunked_sha256);
});

test("raw non-UTF-8 bytes pass without decoding", async () => {
  const { verifyFile } = await oracle();
  const bytes = Buffer.from([0xff, 0xfe, 0x80, 0x00, 0x0a]);
  const result = verifyFile({
    actualPath: write("non-utf8.bin", bytes),
    expectedHex: "fffe80000a",
    expectedEol: "lf",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.actual.bom, "none");
  assert.deepEqual(result.actual.eol, { kind: "lf", crlf: 0, lf: 1, cr: 0 });
});

test("a missing UTF-8 BOM is identified separately from the byte mismatch", async () => {
  const { verifyFile } = await oracle();
  const actual = Buffer.from("alpha\n", "utf8");
  const expected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), actual]);
  const result = verifyFile({
    actualPath: write("missing-bom.txt", actual),
    expectedHex: hex(expected),
    expectedEol: "lf",
  });

  assert.equal(result.status, "actual_mismatch");
  assert.equal(result.actual.bom, "none");
  assert.equal(result.expected.bom, "utf8");
  assert.deepEqual(result.issues.map(({ code }) => code),
    ["bytes_mismatch", "bom_mismatch"]);
});

test("readers agreeing on wrong bytes reports actual_mismatch, not oracle failure", async () => {
  const { verifyFile } = await oracle();
  const actual = Buffer.from("alpha\nbeta CHANGED\n", "utf8");
  const expected = Buffer.from("alpha\nbeta\n", "utf8");
  const result = verifyFile({
    actualPath: write("wrong-content.txt", actual),
    expectedHex: hex(expected),
    expectedEol: "lf",
  });

  assert.equal(result.status, "actual_mismatch");
  assert.equal(result.exit_code, 1);
  assert.equal(result.readers.agree, true);
  assert.deepEqual(result.issues.map(({ code }) => code), ["bytes_mismatch"]);
});

test("exact bytes with the wrong declared EOL reports only eol_mismatch", async () => {
  const { verifyFile } = await oracle();
  const bytes = Buffer.from("alpha\r\nbeta\r\n", "utf8");
  const result = verifyFile({
    actualPath: write("wrong-eol-expectation.txt", bytes),
    expectedHex: hex(bytes),
    expectedEol: "lf",
  });

  assert.equal(result.status, "actual_mismatch");
  assert.deepEqual(result.issues.map(({ code }) => code), ["eol_mismatch"]);
});

test("disagreement between whole and chunked reads is an oracle failure", async () => {
  const { evaluateReads } = await oracle();
  const whole = Buffer.from("same source\n", "utf8");
  const chunked = Buffer.from("corrupted read\n", "utf8");
  const result = evaluateReads({
    actualPath: "synthetic-reader-disagreement",
    whole,
    chunked,
    expectedHex: hex(whole),
    expectedEol: "lf",
  });

  assert.equal(result.status, "oracle_internal_disagreement");
  assert.equal(result.exit_code, 3);
  assert.equal(result.readers.agree, false);
  assert.deepEqual(result.issues.map(({ code }) => code), ["reader_disagreement"]);
});

test("an unreadable input is distinct from a content mismatch", async () => {
  const { verifyFile } = await oracle();
  const result = verifyFile({
    actualPath: path.join(sandbox, "missing.txt"),
    expectedHex: "00",
    expectedEol: "none",
  });

  assert.equal(result.status, "input_unreadable");
  assert.equal(result.exit_code, 2);
  assert.equal(result.readers.agree, null);
  assert.deepEqual(result.issues.map(({ code }) => code), ["input_unreadable"]);
});

test("invalid expected hex is refused before reading the actual file", async () => {
  const { verifyFile } = await oracle();
  const result = verifyFile({
    actualPath: path.join(sandbox, "also-missing.txt"),
    expectedHex: "not-hex",
    expectedEol: "lf",
  });

  assert.equal(result.status, "invalid_spec");
  assert.equal(result.exit_code, 2);
  assert.deepEqual(result.issues.map(({ code }) => code), ["invalid_expected_hex"]);
});

test("CLI emits stable JSON and distinct pass versus mismatch exits", () => {
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]);
  const actualPath = write("cli-bom-lf.txt", bytes);
  const baseArgs = [ORACLE, "--actual", actualPath, "--expected-hex", hex(bytes)];

  const pass = spawnSync(process.execPath, [...baseArgs, "--expected-eol", "lf"], {
    encoding: "utf8",
  });
  assert.equal(pass.status, 0, pass.stderr);
  const passBody = JSON.parse(pass.stdout);
  assert.equal(passBody.status, "pass");
  assert.equal(passBody.actual.bom, "utf8");
  assert.equal(passBody.expected.bom, "utf8");
  assert.deepEqual(passBody.actual.eol, { kind: "lf", crlf: 0, lf: 1, cr: 0 });

  const mismatch = spawnSync(process.execPath,
    [...baseArgs, "--expected-eol", "crlf"], { encoding: "utf8" });
  assert.equal(mismatch.status, 1, mismatch.stderr);
  const mismatchBody = JSON.parse(mismatch.stdout);
  assert.equal(mismatchBody.status, "actual_mismatch");
  assert.deepEqual(mismatchBody.issues.map(({ code }) => code), ["eol_mismatch"]);
});
