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
