import { dialog } from "electron";
import type { RootPickerPort, RootPickerResult } from "../sms/file-manager-ports";

export interface RootPickerAdapterOptions {
  stubSelection?: string | null;
  nativePicker?: () => Promise<{ canceled: boolean; filePaths: string[] }>;
}

export class WindowsRootPickerAdapter implements RootPickerPort {
  constructor(private readonly options: RootPickerAdapterOptions = {}) {}

  async chooseRoot(): Promise<RootPickerResult> {
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
