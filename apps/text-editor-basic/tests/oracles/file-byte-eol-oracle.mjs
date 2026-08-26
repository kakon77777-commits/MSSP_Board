// External raw-byte oracle for the A0 file loop.
//
// This module deliberately imports no application code. It reads the output
// file through two separate filesystem paths, compares raw bytes against an
// independently supplied hex expectation, and profiles line endings without
// decoding or normalising text.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VALID_EOL = new Set(["none", "lf", "crlf", "cr", "mixed"]);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function detectBom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? "utf8"
    : "none";
}

export function profileEol(bytes) {
  const raw = Buffer.from(bytes);
  let crlf = 0;
  let lf = 0;
  let cr = 0;

  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === 0x0d) {
      if (raw[index + 1] === 0x0a) {
        crlf += 1;
        index += 1;
      } else {
        cr += 1;
      }
    } else if (raw[index] === 0x0a) {
      lf += 1;
    }
  }

  const present = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  const kind = present === 0 ? "none"
    : present > 1 ? "mixed"
      : crlf > 0 ? "crlf"
        : lf > 0 ? "lf"
          : "cr";
  return { kind, crlf, lf, cr };
}

function parseSpec(expectedHex, expectedEol) {
  if (typeof expectedHex !== "string" || expectedHex.length % 2 !== 0
    || !/^[0-9a-fA-F]*$/.test(expectedHex)) {
    return { issue: "invalid_expected_hex" };
  }
  if (!VALID_EOL.has(expectedEol)) return { issue: "invalid_expected_eol" };
  return { bytes: Buffer.from(expectedHex, "hex") };
}

function expectedEvidence(bytes, expectedEol) {
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    bom: detectBom(bytes),
    eol: expectedEol,
  };
}

function invalidResult(actualPath, status, issue, expected = null) {
  return {
    schema_version: "1.0",
    status,
    exit_code: 2,
    actual_path: path.resolve(actualPath),
    expected,
    readers: { agree: null, whole_sha256: null, chunked_sha256: null },
    actual: null,
    issues: [{ code: issue }],
  };
}

export function evaluateReads({ actualPath, whole, chunked, expectedHex, expectedEol }) {
  const spec = parseSpec(expectedHex, expectedEol);
  if (spec.issue) return invalidResult(actualPath, "invalid_spec", spec.issue);

  const wholeBytes = Buffer.from(whole);
  const chunkedBytes = Buffer.from(chunked);
  const wholeHash = sha256(wholeBytes);
  const chunkedHash = sha256(chunkedBytes);
  const expected = expectedEvidence(spec.bytes, expectedEol);
  const readers = {
    agree: wholeBytes.equals(chunkedBytes),
    whole_sha256: wholeHash,
    chunked_sha256: chunkedHash,
  };

  if (!readers.agree) {
    return {
      schema_version: "1.0",
      status: "oracle_internal_disagreement",
      exit_code: 3,
      actual_path: path.resolve(actualPath),
      expected,
      readers,
      actual: null,
      issues: [{ code: "reader_disagreement" }],
    };
  }

  const eol = profileEol(wholeBytes);
  const actual = { bytes: wholeBytes.length, sha256: wholeHash, bom: detectBom(wholeBytes), eol };
  const issues = [];
  if (!wholeBytes.equals(spec.bytes)) issues.push({ code: "bytes_mismatch" });
  if (actual.bom !== expected.bom) issues.push({ code: "bom_mismatch" });
  if (eol.kind !== expectedEol) issues.push({ code: "eol_mismatch" });

  return {
    schema_version: "1.0",
    status: issues.length === 0 ? "pass" : "actual_mismatch",
    exit_code: issues.length === 0 ? 0 : 1,
    actual_path: path.resolve(actualPath),
    expected,
    readers,
    actual,
    issues,
  };
}

function readChunked(actualPath) {
  const descriptor = fs.openSync(actualPath, "r");
  const chunks = [];
  const scratch = Buffer.alloc(7);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, scratch, 0, scratch.length, null);
      if (count === 0) break;
      chunks.push(Buffer.from(scratch.subarray(0, count)));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return Buffer.concat(chunks);
}

export function verifyFile({ actualPath, expectedHex, expectedEol }) {
  const spec = parseSpec(expectedHex, expectedEol);
  if (spec.issue) return invalidResult(actualPath, "invalid_spec", spec.issue);

  let whole;
  try {
    whole = fs.readFileSync(actualPath);
  } catch (error) {
    return invalidResult(actualPath, "input_unreadable", "input_unreadable",
      expectedEvidence(spec.bytes, expectedEol));
  }

  let chunked;
  try {
    chunked = readChunked(actualPath);
  } catch (error) {
    return {
      schema_version: "1.0",
      status: "oracle_internal_disagreement",
      exit_code: 3,
      actual_path: path.resolve(actualPath),
      expected: expectedEvidence(spec.bytes, expectedEol),
      readers: { agree: false, whole_sha256: sha256(whole), chunked_sha256: null },
      actual: null,
      issues: [{ code: "chunked_read_failed" }],
    };
  }

  return evaluateReads({ actualPath, whole, chunked, expectedHex, expectedEol });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values[flag] !== undefined) return null;
    values[flag] = value;
  }
  const allowed = new Set(["--actual", "--expected-hex", "--expected-eol"]);
  if (Object.keys(values).some((flag) => !allowed.has(flag))) return null;
  if (allowed.size !== Object.keys(values).length) return null;
  return {
    actualPath: values["--actual"],
    expectedHex: values["--expected-hex"],
    expectedEol: values["--expected-eol"],
  };
}

function runCli() {
  const input = parseArgs(process.argv.slice(2));
  const result = input
    ? verifyFile(input)
    : invalidResult(".", "invalid_spec", "invalid_cli_arguments");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.exit_code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
