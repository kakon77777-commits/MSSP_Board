// First executable RED for the A2 implementation.
//
// This test deliberately checks one thing only: the agreed SMS contract module
// must exist in the built artifact before behavior-specific acceptance can load
// the exact types/interfaces it is meant to observe.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const builtContract = path.join(here, "..", "..", "..", "dist", "sms",
  "document-format-contract.js");

test("A2 SMS document-format contract is present in the built artifact", () => {
  assert.ok(fs.existsSync(builtContract),
    "A2 RED: dist/sms/document-format-contract.js is absent; "
    + "the agreed core contract has not been implemented");
});
