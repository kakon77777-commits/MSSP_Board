export type SnapshotGeneration = number;
export type RootId = string;
export type EntryId = string;
export type EntryKind = "file" | "directory" | "reparse";
export type ViewCompleteness = "complete" | "partial";
export type EvidencePath = "stubbed" | "native";

export type ObservationFailureCode =
  | "root_unreachable_after_operation"
  | "snapshot_read_failed"
  | "root_removed"
  | "entry_observation_failed";

export type RefusalCode =
  | "invalid_argument"
  | "invalid_entry_id"
  | "stale_generation"
  | "duplicate_entry_id"
  | "invalid_name"
  | "path_rejected"
  | "reparse_refused"
  | "conflict"
  | "navigate_above_root"
  | "cross_device_move_unsupported";

export type ExecutionFailureCode =
  | "root_picker_failed"
  | "root_snapshot_read_failed"
  | "directory_read_failed"
  | "filesystem_operation_failed"
  | "recycle_failed";

export interface RootDescriptor {
  rootId: RootId;
  displayName: string;
}

export interface EntryView {
  entryId: EntryId;
  name: string;
  kind: EntryKind;
  byteLength: number | null;
}

export interface DirectorySnapshot {
  schema: "fm.directory-snapshot/v1";
  root: RootDescriptor;
  generation: SnapshotGeneration;
  directoryId: EntryId | null;
  parentEntryId: EntryId | null;
  completeness: ViewCompleteness;
  entries: EntryView[];
  observationErrors: Array<{ entryId: EntryId | null; code: ObservationFailureCode }>;
}

export type SnapshotResult =
  | { state: "current"; snapshot: DirectorySnapshot }
  | { state: "unchanged"; snapshot: DirectorySnapshot }
  | {
      state: "unavailable";
      snapshot: null;
      lastPublishedGeneration: SnapshotGeneration;
      code: ObservationFailureCode;
    };

export interface MutationRequestItem {
  ordinal: number;
  submittedEntryId: string | null;
}

export type EntryOutcome =
  | { ordinal: number; entryId: EntryId; status: "accepted" }
  | {
      ordinal: number;
      submittedEntryId: string | null;
      status: "refused";
      code: RefusalCode;
    }
  | {
      ordinal: number;
      entryId: EntryId;
      status: "failed";
      code: ExecutionFailureCode;
    };

export type MutationOperation = "rename" | "copy" | "move" | "trash";

export interface MutationResult {
  operation: MutationOperation;
  overallStatus: "accepted" | "partial" | "refused" | "failed";
  outcomes: EntryOutcome[];
  snapshot: SnapshotResult;
  evidencePath: EvidencePath;
}

export interface RootSessionView {
  snapshot: DirectorySnapshot;
}

export type CreateDirectoryResult =
  | {
      status: "accepted";
      createdName: string;
      snapshot: Extract<SnapshotResult, { state: "current" | "unavailable" }>;
      evidencePath: EvidencePath;
    }
  | {
      status: "refused";
      requestedName: string;
      code: RefusalCode;
      snapshot: Extract<SnapshotResult, { state: "unchanged" }>;
      evidencePath: EvidencePath;
    }
  | {
      status: "failed";
      requestedName: string;
      code: ExecutionFailureCode;
      snapshot: SnapshotResult;
      evidencePath: EvidencePath;
    };

export type ViewCommandResult =
  | {
      operation: "navigate" | "refresh";
      status: "accepted";
      snapshot: Extract<SnapshotResult, { state: "current" }>;
      evidencePath: EvidencePath;
    }
  | {
      operation: "navigate" | "refresh";
      status: "refused";
      code: RefusalCode;
      snapshot: Extract<SnapshotResult, { state: "unchanged" }>;
      evidencePath: EvidencePath;
    }
  | {
      operation: "navigate" | "refresh";
      status: "failed";
      code: ExecutionFailureCode | ObservationFailureCode;
      snapshot: SnapshotResult;
      evidencePath: EvidencePath;
    };

export interface SelectionRequestItem {
  ordinal: number;
  submittedEntryId: string | null;
}

export type SelectionItemOutcome =
  | { ordinal: number; status: "accepted"; entryId: EntryId }
  | {
      ordinal: number;
      submittedEntryId: string | null;
      status: "refused";
      code: "missing_entry_id" | "duplicate_entry_id" | "unknown_entry_id" | "cross_generation_entry_id";
    };

export type RefusedSelectionItemOutcome = Extract<SelectionItemOutcome, { status: "refused" }>;
export type AcceptedSelectionItemOutcome = Extract<SelectionItemOutcome, { status: "accepted" }>;

export type SelectionResult =
  | {
      status: "accepted";
      outcomes: AcceptedSelectionItemOutcome[];
      currentSnapshot: DirectorySnapshot;
      evidencePath: EvidencePath;
    }
  | {
      status: "refused";
      code: RefusalCode;
      outcomes: RefusedSelectionItemOutcome[];
      priorSelectedEntryIds: EntryId[];
      currentSnapshot: DirectorySnapshot;
      evidencePath: EvidencePath;
    };

export type DirectoryObservationResult =
  | {
      status: "observed";
      snapshot: Extract<SnapshotResult, { state: "current" }>;
      evidencePath: EvidencePath;
    }
  | {
      status: "failed";
      code: ObservationFailureCode;
      snapshot: SnapshotResult;
      evidencePath: EvidencePath;
    };

export type RootSelectionResult =
  | { status: "accepted"; snapshot: DirectorySnapshot; evidencePath: EvidencePath }
  | { status: "cancelled"; prior: RootSessionView | null; evidencePath: EvidencePath }
  | { status: "refused"; code: RefusalCode; prior: RootSessionView | null; evidencePath: EvidencePath }
  | { status: "failed"; code: ExecutionFailureCode; prior: RootSessionView | null; evidencePath: EvidencePath };
