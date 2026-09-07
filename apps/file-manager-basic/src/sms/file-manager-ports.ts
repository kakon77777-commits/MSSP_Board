import type {
  DirectorySnapshot,
  DirectoryObservationResult,
  EntryId,
  EntryAuthorityRole,
  EntryKind,
  EvidencePath,
  SnapshotResult,
  SnapshotGeneration,
} from "./file-manager-contract";

export type NameValidationPort = (value: unknown) =>
  | { ok: true; value: string }
  | { ok: false; code: "invalid_name" | "invalid_argument" };

export type RootPickerResult =
  | { state: "selected"; path: string; evidencePath: EvidencePath }
  | { state: "cancelled"; evidencePath: EvidencePath };

export interface RootPickerPort {
  chooseRoot(): Promise<RootPickerResult>;
}

export interface FileStat {
  kind: EntryKind;
  byteLength: number | null;
  isReparse: boolean;
}

export interface FilesystemPort {
  join(parent: string, singleSegmentName: string): string;
  parent(path: string): string;
  baseName(path: string): string;
  same(left: string, right: string): boolean;
  isWithin(root: string, candidate: string): boolean;
  lstat(path: string): Promise<FileStat>;
  readDirectory(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

export interface RecyclePort {
  recycle(path: string): Promise<void>;
}

export interface IdentityResolution {
  entryId: EntryId;
  canonicalPath: string;
  generation: SnapshotGeneration;
  kind: EntryKind;
  role: EntryAuthorityRole;
}

export interface IdentityPort {
  beginGeneration(generation: SnapshotGeneration): void;
  issue(canonicalPath: string, kind: EntryKind, role: EntryAuthorityRole): EntryId;
  resolve(entryId: string, generation: SnapshotGeneration): IdentityResolution | null;
  classify(entryId: string, generation: SnapshotGeneration): "current" | "cross_generation" | "unknown";
  currentGeneration(): SnapshotGeneration | null;
}

export interface SnapshotBuildInput {
  rootPath: string;
  rootId: string;
  rootDisplayName: string;
  directoryPath: string;
  generation: SnapshotGeneration;
  evidencePath: EvidencePath;
}

export interface SnapshotPort {
  build(input: SnapshotBuildInput): Promise<DirectoryObservationResult>;
}

export interface MutationContext {
  rootPath: string;
  directoryPath: string;
  snapshot: DirectorySnapshot;
  evidencePath: EvidencePath;
}

export interface MutationSessionPort {
  mutationContext(): MutationContext | null;
  publishAfterMutation(): Promise<SnapshotResult>;
}
