// A0 / file loop — reading and writing the user's document.
//
// Lives in the main process and nowhere else. The renderer never touches `fs`;
// the preload surface exposes named operations, never a filesystem handle. That
// is `electron_security_boundary`'s "filesystem: reachable only through a
// minimal preload/contextBridge API".
//
// This file owns `encoding_policy` in full:
//
//   read  UTF-8 only; anything else is refused BY NAME, never guessed
//   bom   a UTF-8 BOM present on read is preserved on write
//   eol   the file's existing line endings are preserved; a new document uses LF
//
// Every one of those three is a property of the FILE, carried on the document
// and written back, rather than a global setting. A global would silently
// convert the second file you open to the first file's conventions.
import fs from "node:fs";
import path from "node:path";

export type Eol = "lf" | "crlf";

export interface DocumentBytes {
  /** Text as the user sees it, always with LF separators internally. */
  text: string;
  /** Whether the file on disk began with a UTF-8 BOM. */
  bom: boolean;
  /** The line endings the file on disk used. */
  eol: Eol;
}

/** A refusal the user is meant to read, carrying the name of what was refused. */
export class DocumentRefusal extends Error {
  readonly fileName: string;

  constructor(fileName: string, reason: string) {
    // encoding_policy says non-UTF-8 is "refused by name, never guessed", so the
    // name is in the message rather than in a log line nobody reads, and the
    // wording never offers to fall back to another encoding.
    super(`${fileName}: ${reason}`);
    this.name = "DocumentRefusal";
    this.fileName = fileName;
  }
}

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

/**
 * Resolve to an absolute, normalised path. Validation belongs here, in the main
 * process, because a renderer-side check protects nothing: the renderer is the
 * side that can be compromised.
 */
export function normalisePath(candidate: string): string {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new DocumentRefusal(String(candidate), "not a usable path");
  }
  const resolved = path.resolve(candidate);
  // A path containing a NUL is not a path; some filesystems truncate at it,
  // which would open a different file from the one that was checked.
  if (resolved.includes("\0")) {
    throw new DocumentRefusal(path.basename(candidate), "path contains a NUL byte");
  }
  return resolved;
}

/**
 * Read a document, or refuse it by name.
 *
 * Decoding uses TextDecoder with `fatal: true`. Buffer.toString("utf8") would
 * substitute U+FFFD for invalid bytes and return a string — the file would open,
 * visibly corrupted, and a later save would write the corruption back. Refusing
 * is the whole point of the policy; silently repairing is what it forbids.
 */
export function readDocument(filePath: string): DocumentBytes {
  const resolved = normalisePath(filePath);
  const name = path.basename(resolved);

  let raw: Buffer;
  try {
    raw = fs.readFileSync(resolved);
  } catch (cause) {
    throw new DocumentRefusal(name, `cannot be read (${(cause as NodeJS.ErrnoException).code})`);
  }

  const bom = raw.subarray(0, 3).equals(BOM);
  const body = bom ? raw.subarray(3) : raw;
  const eol = body.includes(Buffer.from("\r\n")) ? "crlf" : "lf";

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new DocumentRefusal(name, "is not valid UTF-8 and will not be opened");
  }

  return { text: text.replace(/\r\n/g, "\n"), bom, eol };
}

/**
 * Turn an edited document back into the exact bytes to write.
 *
 * The BOM and EOL come from the document that was opened, not from a setting,
 * so a CRLF file stays CRLF and a BOM survives a round trip. A new document has
 * `eol: "lf"` and `bom: false` by policy.
 */
export function serialiseDocument(text: string, doc: Pick<DocumentBytes, "bom" | "eol">): Buffer {
  const normalised = text.replace(/\r\n/g, "\n");
  const withEol = doc.eol === "crlf" ? normalised.replace(/\n/g, "\r\n") : normalised;
  const body = Buffer.from(withEol, "utf8");
  return doc.bom ? Buffer.concat([BOM, body]) : body;
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
      path.basename(resolved), `cannot be written (${(cause as NodeJS.ErrnoException).code})`);
  }
}

/** The state a brand-new document starts in. `eol: "lf"` is policy, not taste. */
export function newDocument(): DocumentBytes {
  return { text: "", bom: false, eol: "lf" };
}
