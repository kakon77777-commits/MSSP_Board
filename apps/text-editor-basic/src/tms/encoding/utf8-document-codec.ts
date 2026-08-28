import type {
  BomKind,
  DecodeResult,
  DocumentFormat,
  DocumentFormatCodec,
  EolKind,
} from "../../sms/document-format-contract";

const UTF8_BOM: readonly [number, number, number] = [0xef, 0xbb, 0xbf];

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  );
}

function detectEol(text: string): EolKind {
  return text.includes("\r\n") ? "crlf" : "lf";
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function convertLfTo(text: string, eol: EolKind): string {
  return eol === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

function prependBom(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 3);
  out[0] = UTF8_BOM[0];
  out[1] = UTF8_BOM[1];
  out[2] = UTF8_BOM[2];
  out.set(bytes, 3);
  return out;
}

export const utf8DocumentCodec: DocumentFormatCodec = {
  id: "utf8-document-codec-v1",

  decode(bytes: Uint8Array, fileName: string): DecodeResult {
    const bom: BomKind = hasUtf8Bom(bytes) ? "present" : "absent";
    const payload = bom === "present" ? bytes.subarray(3) : bytes;

    let decoded: string;
    try {
      decoded = fatalUtf8Decoder.decode(payload);
    } catch {
      return {
        ok: false,
        refusal: {
          code: "not_utf8",
          fileName,
          message: `${fileName} is not valid UTF-8 and will not be opened.`,
        },
      };
    }

    return {
      ok: true,
      document: {
        text: normalizeToLf(decoded),
        format: {
          encoding: "utf-8",
          bom,
          eol: detectEol(decoded),
          rawByteLength: bytes.length,
        },
      },
    };
  },

  encode(text: string, format: DocumentFormat): Uint8Array {
    const body = convertLfTo(text, format.eol);
    const encoded = utf8Encoder.encode(body);
    return format.bom === "present" ? prependBom(encoded) : encoded;
  },
};