// The seam between what a read measured and what the window shows.
//
// This module exists because the correctness of the hop spans three units: the
// codec that measures a format, the reader that hands it up, and the projection
// that renders it. No one of those specs can define it — each was written blind
// to the other two, and each obeyed its own spec exactly while the byte count
// fell through the gap between them.
//
// It decides nothing. It carries. Every value below comes from the read; not one
// is computed here, because a boundary that computed its own format could
// disagree with the file that was actually opened.
import path from "node:path";

import type {
  BoundarySnapshot, DocumentFormat,
} from "../sms/document-format-contract";

/** The schema tag the visibility row matches on. Stated once, here. */
const SCHEMA = "a2.document-format/v1" as const;

/**
 * Build the snapshot the renderer projects.
 *
 * `boundaryGeneration` is supplied by the caller that owns the document epoch,
 * not incremented here: a snapshot builder that advanced the generation would
 * make every render look like a new document.
 */
export function boundarySnapshot(
  format: DocumentFormat,
  filePath: string | null,
  dirty: boolean,
  boundaryGeneration: number,
): BoundarySnapshot {
  return {
    fileName: filePath === null ? null : path.basename(filePath),
    format: { ...format, schema: SCHEMA },
    dirty,
    boundaryGeneration,
  };
}

/**
 * The format to write a document back with.
 *
 * `rawByteLength` describes the bytes that were read, so it is dropped on the
 * way out: keeping it would state a measurement of the input as though it
 * described the output.
 */
export function outputFormat(format: DocumentFormat): DocumentFormat {
  return { ...format, rawByteLength: null };
}
