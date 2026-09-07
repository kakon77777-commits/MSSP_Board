import crypto from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function walk(root, relative = "") {
  const absolute = relative === "" ? root : path.join(root, ...relative.split("/"));
  const found = [];
  for (const name of readdirSync(absolute).sort()) {
    const child = relative === "" ? name : `${relative}/${name}`;
    const childAbsolute = path.join(root, ...child.split("/"));
    const stat = lstatSync(childAbsolute);
    if (stat.isSymbolicLink()) {
      found.push({ path: child, kind: "reparse" });
    } else if (stat.isDirectory()) {
      found.push({ path: child, kind: "directory" });
      found.push(...walk(root, child));
    } else if (stat.isFile()) {
      const bytes = readFileSync(childAbsolute);
      found.push({ path: child, kind: "file", bytes: bytes.length, sha256: sha256(bytes) });
    } else {
      found.push({ path: child, kind: "other" });
    }
  }
  return found;
}

export function verifyTree(root, manifest) {
  if (manifest?.schema !== "mssp.file-manager.acceptance-fixture/v0"
      || !Array.isArray(manifest.entries)) {
    throw new Error("invalid acceptance fixture manifest");
  }
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const actualEntries = walk(root);
  const actual = new Map(actualEntries.map((entry) => [entry.path, entry]));
  const mismatches = [];

  for (const entry of manifest.entries) {
    const observed = actual.get(entry.path);
    if (observed === undefined) {
      mismatches.push({ path: entry.path, kind: "missing", expected: entry.kind, actual: null });
      continue;
    }
    if (observed.kind !== entry.kind) {
      mismatches.push({ path: entry.path, kind: "kind", expected: entry.kind, actual: observed.kind });
      continue;
    }
    if (entry.kind === "file" && observed.bytes !== entry.bytes) {
      mismatches.push({ path: entry.path, kind: "bytes", expected: entry.bytes, actual: observed.bytes });
    }
    if (entry.kind === "file" && observed.sha256 !== entry.sha256) {
      mismatches.push({ path: entry.path, kind: "sha256", expected: entry.sha256, actual: observed.sha256 });
    }
  }
  for (const entry of actualEntries) {
    if (!expected.has(entry.path)) {
      mismatches.push({ path: entry.path, kind: "unexpected", expected: null, actual: entry.kind });
    }
  }

  mismatches.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  return {
    status: mismatches.length === 0 ? "match" : "mismatch",
    checkedEntries: manifest.entries.length,
    mismatches,
  };
}
