import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(
  here,
  "..",
  "src",
  "tms",
  "encoding",
  "unit.manifest.json",
);
const MANIFEST = process.env.MSSP_UNIT_MANIFEST
  ? path.resolve(process.env.MSSP_UNIT_MANIFEST)
  : DEFAULT_MANIFEST;

const EXPECTED = {
  schema: "mssp.unit/v1",
  unit_id: "tms/utf8-document-codec-v1",
  role: "TMS",
  implements: ["sms/DocumentFormatCodec"],
  allowed_imports: ["sms/document-format-contract"],
  forbidden_roles: ["dms", "renderer", "preload", "main", "other-tms"],
};
const EXPECTED_BYTES = 305;
const EXPECTED_SHA256 =
  "271b528bb3f1559887139dcb04829dbfa10be124511abcd12fa27294b3e85a85";

test("the codec unit manifest is the exact frozen declaration", () => {
  assert.equal(fs.existsSync(MANIFEST), true, `manifest is missing: ${MANIFEST}`);

  const bytes = fs.readFileSync(MANIFEST);
  assert.equal(bytes.length, EXPECTED_BYTES);
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    EXPECTED_SHA256,
  );
  assert.equal(bytes.at(-1), 0x0a, "manifest must end in one LF");
  assert.notEqual(bytes.at(-2), 0x0a, "manifest must end in exactly one LF");

  const actual = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(actual, EXPECTED);
  assert.equal(bytes.toString("utf8"), `${JSON.stringify(EXPECTED, null, 2)}\n`);
});
