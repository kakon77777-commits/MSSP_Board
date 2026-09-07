import type { EntryId, EntryKind, SnapshotGeneration } from "../sms/file-manager-contract";
import type { IdentityPort, IdentityResolution } from "../sms/file-manager-ports";

export type EntryIdTokenFactory = () => string | undefined;

export class EntryIdRegistry implements IdentityPort {
  readonly #tokenFactory: EntryIdTokenFactory;
  #generation: SnapshotGeneration | null = null;
  readonly #byId = new Map<EntryId, IdentityResolution>();
  readonly #byPath = new Map<string, EntryId>();

  constructor(tokenFactory: EntryIdTokenFactory) {
    this.#tokenFactory = tokenFactory;
  }

  beginGeneration(generation: SnapshotGeneration): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new TypeError("generation must be a positive safe integer");
    }
    this.#generation = generation;
    this.#byId.clear();
    this.#byPath.clear();
  }

  issue(canonicalPath: string, kind: EntryKind): EntryId {
    if (this.#generation === null) throw new Error("cannot issue an entry id before a generation begins");
    const existing = this.#byPath.get(canonicalPath);
    if (existing) {
      const resolution = this.#byId.get(existing);
      if (resolution?.kind !== kind) throw new Error("entry kind changed within one generation");
      return existing;
    }
    const token = this.#tokenFactory();
    if (!token) throw new Error("entry id token factory returned no token");
    const entryId = `entry:${token}`;
    if (this.#byId.has(entryId)) throw new Error("entry id token collision");
    const resolution: IdentityResolution = {
      entryId,
      canonicalPath,
      generation: this.#generation,
      kind,
    };
    this.#byId.set(entryId, resolution);
    this.#byPath.set(canonicalPath, entryId);
    return entryId;
  }

  resolve(entryId: string, generation: SnapshotGeneration): IdentityResolution | null {
    if (generation !== this.#generation) return null;
    const resolution = this.#byId.get(entryId);
    return resolution ? { ...resolution } : null;
  }

  currentGeneration(): SnapshotGeneration | null {
    return this.#generation;
  }
}
