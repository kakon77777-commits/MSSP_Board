export type NameValidationResult =
  | { ok: true; value: string }
  | { ok: false; code: "invalid_name" | "invalid_argument" };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const DRIVE_ABSOLUTE = /^[a-z]:[\\/]/i;
const UNC_OR_DEVICE = /^(?:\\\\|\/\/|\\\?\\|\\\.\\)/;

export function validateSingleSegmentName(value: unknown): NameValidationResult {
  if (typeof value !== "string") return { ok: false, code: "invalid_argument" };
  if (value.length === 0 || value === "." || value === ".."
      || value.includes("/") || value.includes("\\") || value.includes(":")
      || value.includes("\0") || DRIVE_ABSOLUTE.test(value) || UNC_OR_DEVICE.test(value)
      || /[. ]$/.test(value) || WINDOWS_RESERVED.test(value)) {
    return { ok: false, code: "invalid_name" };
  }
  return { ok: true, value };
}
