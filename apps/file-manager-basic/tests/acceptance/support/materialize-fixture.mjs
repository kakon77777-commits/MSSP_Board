import crypto from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const exactKeys = (value, keys) => value !== null && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

export function validateFixtureManifest(manifest) {
  if (!exactKeys(manifest, ["schema", "source", "root_policy", "entries"])
      || manifest.schema !== "mssp.file-manager.acceptance-fixture/v0"
      || !Array.isArray(manifest.entries)
      || manifest.entries.length !== 30) {
    throw new TypeError("invalid acceptance fixture manifest envelope");
  }
  if (!exactKeys(manifest.source, [
    "preregistration_path", "preregistration_bytes", "preregistration_sha256",
  ]) || manifest.source.preregistration_path
      !== "slices/02-file-manager-basic/preregistration.json"
      || manifest.source.preregistration_bytes !== 54512
      || manifest.source.preregistration_sha256
      !== "20CB3AD070242C5FE0C4047E05A59B2E05993F258B35A11B0032503997F13740") {
    throw new TypeError("fixture manifest source is not the approved preregistration");
  }
  if (!exactKeys(manifest.root_policy, [
    "drive", "fresh_per_run", "user_folder_forbidden", "follow_reparse_points",
  ]) || manifest.root_policy.drive !== "D:"
      || manifest.root_policy.fresh_per_run !== true
      || manifest.root_policy.user_folder_forbidden !== true
      || manifest.root_policy.follow_reparse_points !== false) {
    throw new TypeError("invalid fixture root policy");
  }

  const paths = new Map();
  for (const entry of manifest.entries) {
    if (typeof entry?.path !== "string" || entry.path.length === 0
        || entry.path.includes("\\") || entry.path.includes(":")
        || path.posix.isAbsolute(entry.path)
        || entry.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new TypeError(`unsafe fixture path: ${String(entry?.path)}`);
    }
    const folded = entry.path.toLowerCase();
    if (paths.has(folded)) throw new TypeError(`duplicate fixture path: ${entry.path}`);
    paths.set(folded, entry);

    if (entry.kind === "directory") {
      if (!exactKeys(entry, ["path", "kind"])) throw new TypeError(`invalid directory row: ${entry.path}`);
    } else if (entry.kind === "file") {
      if (!exactKeys(entry, ["path", "kind", "bytes", "sha256", "payload_hex"])
          || !Number.isInteger(entry.bytes) || entry.bytes < 0
          || !/^[0-9a-f]{64}$/.test(entry.sha256)
          || !/^(?:[0-9a-f]{2})*$/.test(entry.payload_hex)) {
        throw new TypeError(`invalid file row: ${entry.path}`);
      }
      const bytes = Buffer.from(entry.payload_hex, "hex");
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
        throw new TypeError(`fixture manifest payload mismatch: ${entry.path}`);
      }
    } else {
      throw new TypeError(`unsupported fixture kind: ${String(entry.kind)}`);
    }
  }

  for (const entry of manifest.entries) {
    const parent = path.posix.dirname(entry.path);
    if (parent !== "." && paths.get(parent.toLowerCase())?.kind !== "directory") {
      throw new TypeError(`fixture parent is missing or not a directory: ${entry.path}`);
    }
  }
  return true;
}

export function materializeFixture(root, manifest) {
  if (path.parse(path.resolve(root)).root.toUpperCase() !== "D:\\") {
    throw new Error("acceptance fixture root must be on D:");
  }
  if (readdirSync(root).length !== 0) {
    throw new Error("acceptance fixture root must be empty");
  }
  validateFixtureManifest(manifest);

  const directories = manifest.entries
    .filter((entry) => entry.kind === "directory")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  const files = manifest.entries.filter((entry) => entry.kind === "file");

  for (const entry of directories) {
    mkdirSync(path.join(root, ...entry.path.split("/")), { recursive: false });
  }
  for (const entry of files) {
    const bytes = Buffer.from(entry.payload_hex, "hex");
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`fixture manifest payload mismatch: ${entry.path}`);
    }
    writeFileSync(path.join(root, ...entry.path.split("/")), bytes, { flag: "wx" });
  }
}
