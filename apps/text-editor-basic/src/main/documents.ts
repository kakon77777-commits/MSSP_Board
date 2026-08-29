// A0 / file loop — reading and writing the user's document.
//
// Lives in the main process and nowhere else. The renderer never touches `fs`;
// the preload surface exposes named operations, never a filesystem handle. That
// is `electron_security_boundary`'s "filesystem: reachable only through a
// minimal preload/contextBridge API".
//
// This file no longer implements `encoding_policy`; it OWNS the file loop and
// delegates every byte-level decision to an injected codec:
//
//   read  UTF-8 only; anything else is refused BY NAME, never guessed
//   bom   a UTF-8 BOM present on read is preserved on write
//   eol   the file's existing line endings are preserved; a new document uses LF
//
// Every one of those three is a property of the FILE, carried on the document
// and written back, rather than a global setting. A global would silently
// convert the second file you open to the first file's conventions. What changed
// is only WHERE they are decided: the codec measures the format and this module
// carries it, unmodified, to whoever asked. There is exactly one implementation
// of each rule, and it is not here.
import fs from "node:fs";
import path from "node:path";

import type {
  DecodedDocument, DocumentFormat, DocumentFormatCodec, DocumentRefusalCode,
} from "../sms/document-format-contract";

/**
 * What a read hands up: the text, and the format the codec measured.
 *
 * This is the contract's own `DecodedDocument`. The shape it replaces carried a
 * loose `bom: boolean` and `eol` beside the codec's `DocumentFormat` — two
 * descriptions of one fact, and the loose pair had no room for `rawByteLength`,
 * so a byte count the codec had already computed could never reach a caller.
 */
export type DocumentBytes = DecodedDocument;

/**
 * A refusal the user is meant to read, carrying the name of what was refused.
 *
 * The `code` exists because the cross-process contract carries a typed refusal.
 * Deriving one at the boundary by matching on message text would put the
 * classification in the place furthest from the decision, and every reworded
 * message would silently reclassify itself.
 */
export class DocumentRefusal extends Error {
  readonly fileName: string;
  readonly code: DocumentRefusalCode;

  constructor(fileName: string, reason: string, code: DocumentRefusalCode = "invalid_argument") {
    // encoding_policy says non-UTF-8 is "refused by name, never guessed", so the
    // name is in the message rather than in a log line nobody reads, and the
    // wording never offers to fall back to another encoding.
    super(`${fileName}: ${reason}`);
    this.name = "DocumentRefusal";
    this.fileName = fileName;
    this.code = code;
  }
}

let documentFormatCodec: DocumentFormatCodec | null = null;

/** Install the codec this module reads and writes bytes through. */
export function setDocumentFormatCodec(codec: DocumentFormatCodec): void {
  documentFormatCodec = codec;
}

/**
 * The installed codec, or a refusal naming what could not be acted on.
 *
 * Refusing here rather than falling back to a built-in decoder is deliberate: a
 * fallback would be a second implementation of the encoding rules, and the
 * reason this module has none is that a second one drifts from the first.
 */
function requireCodec(fileName: string | null): DocumentFormatCodec {
  if (documentFormatCodec === null) {
    throw new DocumentRefusal(
      fileName ?? "document", "cannot be handled: no codec is installed", "unreadable");
  }
  return documentFormatCodec;
}

/**
 * Resolve to an absolute, normalised path. Validation belongs here, in the main
 * process, because a renderer-side check protects nothing: the renderer is the
 * side that can be compromised.
 */
export function normalisePath(candidate: string): string {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new DocumentRefusal(String(candidate), "not a usable path", "path_rejected");
  }
  const resolved = path.resolve(candidate);
  // A path containing a NUL is not a path; some filesystems truncate at it,
  // which would open a different file from the one that was checked.
  if (resolved.includes("\0")) {
    throw new DocumentRefusal(
      path.basename(candidate), "path contains a NUL byte", "path_rejected");
  }
  return resolved;
}

/**
 * Read a document, or refuse it by name.
 *
 * The bytes go to the injected codec, which decodes UTF-8 fatally: a lenient
 * decode would substitute U+FFFD for invalid bytes and return a string — the
 * file would open, visibly corrupted, and a later save would write the
 * corruption back. Refusing is the whole point of the policy; silently repairing
 * is what it forbids.
 *
 * The codec's `DecodedDocument` is returned exactly as measured. Rebuilding it
 * here would put a second description of the format in the path, and the one
 * this module invented would be the one callers saw.
 */
export function readDocument(filePath: string): DocumentBytes {
  const resolved = normalisePath(filePath);
  const name = path.basename(resolved);

  let raw: Buffer;
  try {
    raw = fs.readFileSync(resolved);
  } catch (cause) {
    throw new DocumentRefusal(
      name, `cannot be read (${(cause as NodeJS.ErrnoException).code})`, "unreadable");
  }

  const decoded = requireCodec(name).decode(raw, name);
  if (!decoded.ok) {
    throw new DocumentRefusal(name, "is not valid UTF-8 and will not be opened", "not_utf8");
  }
  return decoded.document;
}

/**
 * Turn an edited document back into the exact bytes to write.
 *
 * The format comes from the document that was opened, not from a setting, so a
 * CRLF file stays CRLF and a BOM survives a round trip. A new document is
 * `bom: "absent"`, `eol: "lf"` by policy.
 *
 * The codec's output IS the file's bytes. Nothing here adjusts, re-encodes or
 * re-wraps them: doing so would be a second encoder competing with the first.
 */
export function serialiseDocument(text: string, format: DocumentFormat): Buffer {
  return Buffer.from(requireCodec(null).encode(text, format));
}

/** Write a document atomically enough that a crash cannot leave a half file. */
export function writeDocument(filePath: string, bytes: Buffer): void {
  const resolved = normalisePath(filePath);
  const temp = `${resolved}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, resolved);
  } catch (cause) {
    try { fs.rmSync(temp, { force: true }); } catch { /* the original is intact */ }
    throw new DocumentRefusal(
      path.basename(resolved), `cannot be written (${(cause as NodeJS.ErrnoException).code})`,
      "unwritable");
  }
}

/**
 * The state a brand-new document starts in. `eol: "lf"` is policy, not taste.
 *
 * `rawByteLength` is null rather than 0: nothing was read from disk, and 0 would
 * state that an empty file had been measured.
 */
export function newDocument(): DocumentBytes {
  return {
    text: "",
    format: { encoding: "utf-8", bom: "absent", eol: "lf", rawByteLength: null },
  };
}
