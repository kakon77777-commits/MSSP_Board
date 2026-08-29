export type BomKind = "present" | "absent";
export type EolKind = "lf" | "crlf";
export interface DocumentFormat {
  encoding: "utf-8";
  bom: BomKind;
  eol: EolKind;
  rawByteLength: number | null;
}
export interface DecodedDocument { text: string; format: DocumentFormat; }
export type DocumentRefusalCode =
  | "not_utf8" | "unreadable" | "unwritable" | "path_rejected"
  | "dirty_transition_blocked" | "stale_document" | "no_window" | "invalid_argument";
export interface DocumentRefusal { code: DocumentRefusalCode; fileName: string | null; message: string; }
export type DecodeResult =
  | { ok: true; document: DecodedDocument }
  | { ok: false; refusal: DocumentRefusal & { code: "not_utf8"; fileName: string } };
export interface DocumentFormatCodec {
  readonly id: "utf8-document-codec-v1";
  decode(bytes: Uint8Array, fileName: string): DecodeResult;
  encode(text: string, format: DocumentFormat): Uint8Array;
}

export interface DocumentFormatStateV1 extends DocumentFormat {
  schema: "a2.document-format/v1";
}

export type DocumentOperation = "new" | "open" | "save" | "save-as";

export interface BoundarySnapshot {
  fileName: string | null;
  format: DocumentFormatStateV1;
  dirty: boolean;
  boundaryGeneration: number;
}

/**
 * What every document operation returns across the process boundary.
 *
 * `cancelled` and `refused` are separate variants rather than one `ok: false`
 * with optional fields: a reader that has to guess which one it holds will
 * eventually guess wrong, and the two mean opposite things about whether the
 * user asked for something that failed. Both carry the UNCHANGED boundary, so a
 * caller can prove the current document did not move.
 */
export type DocumentOperationResult =
  | {
      status: "accepted";
      operation: DocumentOperation;
      text?: string;
      boundary: BoundarySnapshot;
      dialogPath: "stubbed" | "native";
    }
  | {
      status: "cancelled";
      operation: DocumentOperation;
      boundary: BoundarySnapshot;
      dialogPath: "stubbed" | "native";
    }
  | {
      status: "refused";
      operation: DocumentOperation;
      refusal: DocumentRefusal;
      boundary: BoundarySnapshot;
      dialogPath: "stubbed" | "native";
    };
