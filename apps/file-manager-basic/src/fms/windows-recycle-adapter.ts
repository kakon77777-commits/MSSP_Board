import { shell } from "electron";
import type { RecyclePort } from "../sms/file-manager-ports";

export type RecoverableTrashOperation = (subject: string) => Promise<void>;

export class WindowsRecycleAdapter implements RecyclePort {
  constructor(
    private readonly trashItem: RecoverableTrashOperation =
      async (subject) => shell.trashItem(subject),
  ) {}

  async recycle(subject: string): Promise<void> {
    await this.trashItem(subject);
  }
}
