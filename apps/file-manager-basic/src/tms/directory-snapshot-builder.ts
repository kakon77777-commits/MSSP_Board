import type {
  DirectoryObservationResult,
  EntryKind,
  EntryView,
  ObservationFailureCode,
} from "../sms/file-manager-contract";
import type {
  FilesystemPort,
  IdentityPort,
  SnapshotBuildInput,
  SnapshotPort,
} from "../sms/file-manager-ports";

interface ObservedEntry {
  name: string;
  canonicalPath: string;
  kind: EntryKind;
  byteLength: number | null;
}

export class DirectorySnapshotBuilder implements SnapshotPort {
  constructor(
    private readonly filesystem: FilesystemPort,
    private readonly identities: IdentityPort,
  ) {}

  async build(input: SnapshotBuildInput): Promise<DirectoryObservationResult> {
    let names: string[];
    try {
      names = await this.filesystem.readDirectory(input.directoryPath);
    } catch {
      const code: ObservationFailureCode = "snapshot_read_failed";
      return {
        status: "failed",
        code,
        snapshot: {
          state: "unavailable",
          snapshot: null,
          lastPublishedGeneration: Math.max(0, input.generation - 1),
          code,
        },
        evidencePath: input.evidencePath,
      };
    }

    const observed: ObservedEntry[] = [];
    const observationErrors: Array<{ entryId: null; code: "entry_observation_failed" }> = [];
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      const subject = this.filesystem.join(input.directoryPath, name);
      try {
        const stat = await this.filesystem.lstat(subject);
        if (!stat.isReparse && stat.kind === "file") {
          await this.filesystem.probeReadableFile(subject);
        }
        observed.push({
          name,
          canonicalPath: subject,
          kind: stat.isReparse ? "reparse" : stat.kind,
          byteLength: stat.kind === "file" && !stat.isReparse ? stat.byteLength : null,
        });
      } catch {
        observationErrors.push({ entryId: null, code: "entry_observation_failed" });
      }
    }

    this.identities.beginGeneration(input.generation);
    const atRoot = this.filesystem.same(input.directoryPath, input.rootPath);
    const directoryId = atRoot
      ? null
      : this.identities.issue(input.directoryPath, "directory", "directory-cursor");
    const parentPath = atRoot ? input.rootPath : this.filesystem.parent(input.directoryPath);
    const parentEntryId = atRoot || this.filesystem.same(parentPath, input.rootPath)
      ? null
      : this.identities.issue(parentPath, "directory", "parent-cursor");
    const entries: EntryView[] = observed.map((entry) => ({
      entryId: this.identities.issue(entry.canonicalPath, entry.kind, "visible-entry"),
      name: entry.name,
      kind: entry.kind,
      byteLength: entry.byteLength,
    }));

    return {
      status: "observed",
      snapshot: {
        state: "current",
        snapshot: {
          schema: "fm.directory-snapshot/v1",
          root: { rootId: input.rootId, displayName: input.rootDisplayName },
          generation: input.generation,
          directoryId,
          parentEntryId,
          completeness: observationErrors.length === 0 ? "complete" : "partial",
          entries,
          observationErrors,
          destinationProjection: { state: "none" },
        },
      },
      evidencePath: input.evidencePath,
    };
  }
}
