import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

const guiPrefix = path.resolve("D:/Ai/work together/.mssp-app2-gui-").toLocaleLowerCase("en-US");
const dollar = String.fromCharCode(36);

function assertAllowedOriginal(originalPath) {
  const resolved = path.resolve(originalPath);
  if (!resolved.toLocaleLowerCase("en-US").startsWith(guiPrefix)) {
    throw new TypeError("recycle evidence is limited to the harness-owned GUI fixture");
  }
  return resolved;
}

function decodeOriginalPath(bytes) {
  if (bytes.length < 24) throw new Error("truncated recycle metadata");
  const version = Number(bytes.readBigUInt64LE(0));
  if (version === 2) {
    if (bytes.length < 28) throw new Error("truncated version-2 recycle metadata");
    const characters = bytes.readUInt32LE(24);
    const end = 28 + characters * 2;
    if (characters < 1 || end > bytes.length) throw new Error("invalid recycle path length");
    return bytes.subarray(28, end).toString("utf16le").replace(/\0+$/, "");
  }
  if (version === 1) {
    return bytes.subarray(24, Math.min(bytes.length, 544)).toString("utf16le").replace(/\0+$/, "");
  }
  throw new Error(`unsupported recycle metadata version ${version}`);
}

function filetimeIso(bytes) {
  const windowsEpoch = 116444736000000000n;
  const filetime = bytes.readBigUInt64LE(16);
  const milliseconds = Number((filetime - windowsEpoch) / 10000n);
  return new Date(milliseconds).toISOString();
}

function recordsFor(originalPath) {
  const original = assertAllowedOriginal(originalPath);
  const recycleRoot = path.join(path.parse(original).root, `${dollar}Recycle.Bin`);
  const matches = [];
  for (const sid of readdirSync(recycleRoot)) {
    const sidRoot = path.join(recycleRoot, sid);
    let names;
    try { names = readdirSync(sidRoot); }
    catch { continue; }
    for (const name of names) {
      if (!name.startsWith(`${dollar}I`)) continue;
      const metadataPath = path.join(sidRoot, name);
      let bytes;
      try { bytes = readFileSync(metadataPath); }
      catch { continue; }
      const recordedOriginal = decodeOriginalPath(bytes);
      if (path.resolve(recordedOriginal).toLocaleLowerCase("en-US")
          !== original.toLocaleLowerCase("en-US")) continue;
      const payloadLeaf = `${dollar}R${name.slice(2)}`;
      const payloadPath = path.join(sidRoot, payloadLeaf);
      if (!existsSync(payloadPath)) throw new Error("recycle metadata has no matching payload");
      const payloadStat = lstatSync(payloadPath);
      matches.push({
        original,
        metadataPath,
        payloadPath,
        evidence: {
          name: path.basename(original),
          deletedFrom: path.dirname(original),
          dateDeleted: filetimeIso(bytes),
          recycleLeaf: payloadLeaf,
          payloadKind: payloadStat.isDirectory() ? "directory" : payloadStat.isFile() ? "file" : "other",
          recordedBytes: Number(bytes.readBigUInt64LE(8)),
        },
      });
    }
  }
  return matches;
}

export function findExactRecycleItems(originalPath) {
  return recordsFor(originalPath).map((record) => record.evidence);
}

export function restoreExactRecycleItem(originalPath) {
  const records = recordsFor(originalPath);
  if (records.length !== 1) throw new Error(`expected one exact recycle item, got ${records.length}`);
  const record = records[0];
  if (existsSync(record.original)) throw new Error("refusing to overwrite an existing restore target");
  if (!existsSync(path.dirname(record.original))) throw new Error("restore parent no longer exists");
  renameSync(record.payloadPath, record.original);
  unlinkSync(record.metadataPath);
  return { restored: true, originalLeaf: path.basename(record.original) };
}
