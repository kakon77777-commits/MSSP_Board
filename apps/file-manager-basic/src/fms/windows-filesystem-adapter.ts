import fs from "node:fs/promises";
import path from "node:path";
import type { FilesystemPort, FileStat } from "../sms/file-manager-ports";

export class WindowsFilesystemAdapter implements FilesystemPort {
  join(parent: string, singleSegmentName: string): string {
    return path.join(parent, singleSegmentName);
  }

  parent(subject: string): string {
    return path.dirname(subject);
  }

  same(left: string, right: string): boolean {
    return path.resolve(left).toLocaleLowerCase("en-US")
      === path.resolve(right).toLocaleLowerCase("en-US");
  }

  async lstat(subject: string): Promise<FileStat> {
    const stat = await fs.lstat(subject);
    const isReparse = stat.isSymbolicLink();
    return {
      kind: isReparse ? "reparse" : stat.isDirectory() ? "directory" : "file",
      byteLength: !isReparse && stat.isFile() ? stat.size : null,
      isReparse,
    };
  }

  async readDirectory(subject: string): Promise<string[]> {
    return fs.readdir(subject);
  }

  async realpath(subject: string): Promise<string> {
    return fs.realpath(subject);
  }

  async exists(subject: string): Promise<boolean> {
    try { await fs.lstat(subject); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async createDirectory(subject: string): Promise<void> {
    await fs.mkdir(subject);
  }

  async rename(from: string, to: string): Promise<void> {
    if (await this.exists(to)) throw Object.assign(new Error("destination conflict"), { code: "EEXIST" });
    await fs.rename(from, to);
  }

  async copy(from: string, to: string): Promise<void> {
    if (await this.exists(to)) throw Object.assign(new Error("destination conflict"), { code: "EEXIST" });
    const stat = await fs.lstat(from);
    if (stat.isDirectory()) {
      await fs.cp(from, to, { recursive: true, force: false, errorOnExist: true });
    } else {
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    }
  }

  async move(from: string, to: string): Promise<void> {
    await this.rename(from, to);
  }
}
