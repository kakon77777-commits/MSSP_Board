import { dialog } from "electron";
import type { RootPickerPort, RootPickerResult } from "../sms/file-manager-ports";

export interface RootPickerAdapterOptions {
  stubSelection?: string | null;
  stubSequence?: Array<string | null>;
  nativePicker?: () => Promise<{ canceled: boolean; filePaths: string[] }>;
}

export class WindowsRootPickerAdapter implements RootPickerPort {
  readonly #stubSequence: Array<string | null> | null;

  constructor(private readonly options: RootPickerAdapterOptions = {}) {
    const hasSelection = Object.hasOwn(options, "stubSelection");
    const hasSequence = Object.hasOwn(options, "stubSequence");
    if (hasSelection && hasSequence) throw new TypeError("exactly one stub mode may be configured");
    if (hasSequence) {
      if (!Array.isArray(options.stubSequence) || options.stubSequence.length === 0) {
        throw new TypeError("stub sequence must be a non-empty array");
      }
      if (!options.stubSequence.every((entry) => entry === null
        || (typeof entry === "string" && entry.length > 0))) {
        throw new TypeError("each stub sequence entry must be a non-empty string or null");
      }
      this.#stubSequence = [...options.stubSequence];
    } else {
      this.#stubSequence = null;
    }
  }

  async chooseRoot(): Promise<RootPickerResult> {
    if (this.#stubSequence !== null) {
      if (this.#stubSequence.length === 0) throw new Error("root picker stub sequence exhausted");
      const next = this.#stubSequence.shift();
      return next === null
        ? { state: "cancelled", evidencePath: "stubbed" }
        : { state: "selected", path: next as string, evidencePath: "stubbed" };
    }
    if (Object.hasOwn(this.options, "stubSelection")) {
      return this.options.stubSelection === null
        ? { state: "cancelled", evidencePath: "stubbed" }
        : { state: "selected", path: this.options.stubSelection as string, evidencePath: "stubbed" };
    }
    const result = await (this.options.nativePicker
      ? this.options.nativePicker()
      : dialog.showOpenDialog({ properties: ["openDirectory"] }));
    if (result.canceled || result.filePaths.length === 0) {
      return { state: "cancelled", evidencePath: "native" };
    }
    return { state: "selected", path: result.filePaths[0], evidencePath: "native" };
  }
}
