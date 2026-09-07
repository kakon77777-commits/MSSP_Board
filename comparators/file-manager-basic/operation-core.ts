import fs from "node:fs/promises";
import path from "node:path";

export type ComparatorEntry = {
  name: string;
  kind: "file" | "directory" | "reparse";
  byteLength: number | null;
};

export type ComparatorView = {
  directory: string;
  entries: ComparatorEntry[];
};

export type RecycleOperation = (subject: string) => Promise<void>;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function segment(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === ".."
      || value.includes("/") || value.includes("\\") || value.includes(":")
      || value.includes("\0") || /[. ]$/.test(value) || WINDOWS_RESERVED.test(value)) {
    throw new TypeError("invalid single-segment name");
  }
  return value;
}

export class OperationCore {
  readonly #root: string;
  readonly #recycle: RecycleOperation;

  private constructor(root: string, recycle: RecycleOperation) {
    this.#root = root;
    this.#recycle = recycle;
  }

  static async open(root: string, recycle: RecycleOperation): Promise<OperationCore> {
    if (typeof recycle !== "function") throw new TypeError("recycle operation is required");
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("root must be an ordinary directory");
    return new OperationCore(await fs.realpath(root), recycle);
  }

  get rootDisplayName(): string {
    return path.basename(this.#root);
  }

  async view(relativeDirectory: string): Promise<ComparatorView> {
    const directory = await this.#directory(relativeDirectory);
    const entries: ComparatorEntry[] = [];
    for (const name of (await fs.readdir(directory)).sort((a, b) => a.localeCompare(b))) {
      const subject = path.join(directory, name);
      const stat = await fs.lstat(subject);
      entries.push({
        name,
        kind: stat.isSymbolicLink() ? "reparse" : stat.isDirectory() ? "directory" : "file",
        byteLength: stat.isFile() && !stat.isSymbolicLink() ? stat.size : null,
      });
    }
    return { directory: path.relative(this.#root, directory).replaceAll("\\", "/"), entries };
  }

  refresh(relativeDirectory: string): Promise<ComparatorView> {
    return this.view(relativeDirectory);
  }

  async navigate(relativeDirectory: string, target: string): Promise<ComparatorView> {
    const current = await this.#directory(relativeDirectory);
    let destination: string;
    if (target === "..") {
      if (current === this.#root) throw new Error("navigate above root refused");
      destination = path.dirname(current);
    } else {
      destination = path.join(current, segment(target));
    }
    await this.#ordinaryInsideDirectory(destination);
    return this.view(path.relative(this.#root, destination).replaceAll("\\", "/"));
  }

  async createDirectory(relativeDirectory: string, name: string): Promise<void> {
    const directory = await this.#directory(relativeDirectory);
    const target = this.#inside(path.join(directory, segment(name)));
    await this.#absent(target);
    await fs.mkdir(target);
  }

  async rename(relativeDirectory: string, fromName: string, toName: string): Promise<void> {
    const directory = await this.#directory(relativeDirectory);
    const source = await this.#ordinaryInside(path.join(directory, segment(fromName)));
    const target = this.#inside(path.join(directory, segment(toName)));
    await this.#absent(target);
    await fs.rename(source, target);
  }

  async copy(relativeDirectory: string, names: string[], destinationRelative: string): Promise<void> {
    const { sources, targets } = await this.#transferPreflight(relativeDirectory, names, destinationRelative);
    for (let index = 0; index < sources.length; index += 1) {
      const stat = await fs.lstat(sources[index]);
      if (stat.isDirectory()) {
        await fs.cp(sources[index], targets[index], { recursive: true, force: false, errorOnExist: true });
      } else {
        await fs.copyFile(sources[index], targets[index], fs.constants.COPYFILE_EXCL);
      }
    }
  }

  async move(relativeDirectory: string, names: string[], destinationRelative: string): Promise<void> {
    const { sources, targets } = await this.#transferPreflight(relativeDirectory, names, destinationRelative);
    for (let index = 0; index < sources.length; index += 1) await fs.rename(sources[index], targets[index]);
  }

  async trash(relativeDirectory: string, names: string[]): Promise<void> {
    const directory = await this.#directory(relativeDirectory);
    const sources = [];
    for (const name of names) sources.push(await this.#ordinaryInside(path.join(directory, segment(name))));
    for (const source of sources) await this.#recycle(source);
  }

  async #transferPreflight(relativeDirectory: string, names: string[], destinationRelative: string) {
    if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length) {
      throw new TypeError("transfer requires distinct source names");
    }
    const sourceDirectory = await this.#directory(relativeDirectory);
    const destination = await this.#directory(destinationRelative);
    const sources: string[] = [];
    const targets: string[] = [];
    for (const name of names) {
      const source = await this.#ordinaryInside(path.join(sourceDirectory, segment(name)));
      const target = this.#inside(path.join(destination, path.basename(source)));
      if (source === target) throw new Error("conflict: source equals destination");
      const stat = await fs.lstat(source);
      if (stat.isDirectory() && this.#contains(source, destination)) {
        throw new Error("destination is inside source");
      }
      await this.#absent(target);
      sources.push(source);
      targets.push(target);
    }
    return { sources, targets };
  }

  async #directory(relative: string): Promise<string> {
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\\")
        || relative.split("/").some((part) => part === ".." || part === ".")) {
      throw new TypeError("invalid relative directory");
    }
    const candidate = this.#inside(path.join(this.#root, ...relative.split("/").filter(Boolean)));
    return this.#ordinaryInsideDirectory(candidate);
  }

  async #ordinaryInside(subject: string): Promise<string> {
    const candidate = this.#inside(subject);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error("reparse refused");
    const canonical = await fs.realpath(candidate);
    return this.#inside(canonical);
  }

  async #ordinaryInsideDirectory(subject: string): Promise<string> {
    const candidate = await this.#ordinaryInside(subject);
    if (!(await fs.lstat(candidate)).isDirectory()) throw new Error("directory required");
    return candidate;
  }

  async #absent(subject: string): Promise<void> {
    try { await fs.lstat(subject); throw new Error("conflict: destination exists"); }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }

  #inside(subject: string): string {
    const candidate = path.resolve(subject);
    if (!this.#contains(this.#root, candidate)) throw new Error("path escapes selected root");
    return candidate;
  }

  #contains(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
  }
}
