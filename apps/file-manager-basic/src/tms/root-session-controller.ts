import type {
  DirectoryObservationResult,
  DirectorySnapshot,
  DestinationCommandResult,
  DestinationProjection,
  EvidencePath,
  RefusedSelectionItemOutcome,
  RootSelectionResult,
  SetDestinationRequest,
  SelectionRequestItem,
  SelectionResult,
  ViewCommandResult,
} from "../sms/file-manager-contract";
import type {
  FilesystemPort,
  IdentityPort,
  RootPickerPort,
  SnapshotPort,
  MutationContext,
  MutationSessionPort,
} from "../sms/file-manager-ports";

export interface RootSessionControllerDependencies {
  picker: RootPickerPort;
  filesystem: FilesystemPort;
  snapshots: SnapshotPort;
  identities: IdentityPort;
  rootToken: () => string | undefined;
}

type PinnedDestination = {
  canonicalPath: string;
  displayName: string;
  isRoot: boolean;
} | null;

export class RootSessionController implements MutationSessionPort {
  readonly #picker: RootPickerPort;
  readonly #filesystem: FilesystemPort;
  readonly #snapshots: SnapshotPort;
  readonly #identities: IdentityPort;
  readonly #rootToken: () => string | undefined;
  #rootPath: string | null = null;
  #rootId: string | null = null;
  #rootDisplayName: string | null = null;
  #directoryPath: string | null = null;
  #snapshot: DirectorySnapshot | null = null;
  #evidencePath: EvidencePath = "native";
  #selectedEntryIds: string[] = [];
  #pinnedDestination: PinnedDestination = null;
  #lastGeneration = 0;

  constructor(dependencies: RootSessionControllerDependencies) {
    this.#picker = dependencies.picker;
    this.#filesystem = dependencies.filesystem;
    this.#snapshots = dependencies.snapshots;
    this.#identities = dependencies.identities;
    this.#rootToken = dependencies.rootToken;
  }

  async chooseRoot(): Promise<RootSelectionResult> {
    const prior = this.#snapshot ? { snapshot: this.#snapshot } : null;
    let picked;
    try { picked = await this.#picker.chooseRoot(); }
    catch {
      return { status: "failed", code: "root_picker_failed", prior, evidencePath: "native" };
    }
    if (picked.state === "cancelled") {
      return { status: "cancelled", prior, evidencePath: picked.evidencePath };
    }

    let canonical: string;
    try {
      const stat = await this.#filesystem.lstat(picked.path);
      if (stat.isReparse || stat.kind === "reparse") {
        return { status: "refused", code: "reparse_refused", prior, evidencePath: picked.evidencePath };
      }
      if (stat.kind !== "directory") {
        return { status: "refused", code: "path_rejected", prior, evidencePath: picked.evidencePath };
      }
      canonical = await this.#filesystem.realpath(picked.path);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { status: "refused", code: "path_rejected", prior, evidencePath: picked.evidencePath };
      }
      return { status: "failed", code: "root_snapshot_read_failed", prior, evidencePath: picked.evidencePath };
    }

    const token = this.#rootToken();
    if (!token) return { status: "failed", code: "root_snapshot_read_failed", prior, evidencePath: picked.evidencePath };
    const generation = this.#lastGeneration + 1;
    const rootId = `root:${token}`;
    const displayName = this.#filesystem.baseName(canonical);
    const result = await this.#snapshots.build({
      rootPath: canonical,
      rootId,
      rootDisplayName: displayName,
      directoryPath: canonical,
      generation,
      evidencePath: picked.evidencePath,
    });
    if (result.status === "failed") {
      return { status: "failed", code: "root_snapshot_read_failed", prior, evidencePath: picked.evidencePath };
    }
    this.#rootPath = canonical;
    this.#rootId = rootId;
    this.#rootDisplayName = displayName;
    this.#directoryPath = canonical;
    this.#snapshot = result.snapshot.snapshot;
    this.#pinnedDestination = null;
    this.#evidencePath = picked.evidencePath;
    this.#selectedEntryIds = [];
    this.#lastGeneration = generation;
    return { status: "accepted", snapshot: this.#snapshot, evidencePath: picked.evidencePath };
  }

  async getCurrentDirectory(): Promise<DirectoryObservationResult> {
    if (!this.#snapshot) {
      return {
        status: "failed",
        code: "root_removed",
        snapshot: {
          state: "unavailable",
          snapshot: null,
          lastPublishedGeneration: this.#lastGeneration,
          code: "root_removed",
        },
        evidencePath: this.#evidencePath,
      };
    }
    return {
      status: "observed",
      snapshot: { state: "current", snapshot: this.#snapshot },
      evidencePath: this.#evidencePath,
    };
  }

  mutationContext(): MutationContext | null {
    if (!this.#rootPath || !this.#directoryPath || !this.#snapshot) return null;
    return {
      rootPath: this.#rootPath,
      directoryPath: this.#directoryPath,
      snapshot: this.#snapshot,
      evidencePath: this.#evidencePath,
    };
  }

  async publishAfterMutation() {
    if (!this.#rootPath || !this.#rootId || !this.#rootDisplayName || !this.#directoryPath) {
      return {
        state: "unavailable" as const,
        snapshot: null,
        lastPublishedGeneration: this.#lastGeneration,
        code: "root_removed" as const,
      };
    }
    const generation = this.#lastGeneration + 1;
    const result = await this.#snapshots.build({
      rootPath: this.#rootPath,
      rootId: this.#rootId,
      rootDisplayName: this.#rootDisplayName,
      directoryPath: this.#directoryPath,
      generation,
      evidencePath: this.#evidencePath,
    });
    if (result.status === "failed") return result.snapshot;
    this.#snapshot = await this.#projectDestination(result.snapshot.snapshot);
    this.#lastGeneration = generation;
    this.#selectedEntryIds = [];
    return { state: "current" as const, snapshot: this.#snapshot };
  }

  async refresh(): Promise<ViewCommandResult> {
    if (!this.#snapshot || !this.#rootPath || !this.#rootId || !this.#rootDisplayName || !this.#directoryPath) {
      return this.#viewFailure("refresh", "root_removed");
    }
    return this.#publish("refresh", this.#directoryPath) as Promise<ViewCommandResult>;
  }

  async navigate(generation: number, entryId: string | null): Promise<ViewCommandResult> {
    if (!this.#snapshot || !this.#rootPath || !this.#directoryPath) {
      return this.#viewFailure("navigate", "root_removed");
    }
    if (generation !== this.#snapshot.generation) {
      return this.#viewRefusal("navigate", "stale_generation");
    }

    let target: string;
    if (entryId === null) {
      if (this.#filesystem.same(this.#directoryPath, this.#rootPath)) {
        return this.#viewRefusal("navigate", "navigate_above_root");
      }
      target = this.#filesystem.parent(this.#directoryPath);
    } else {
      const resolved = this.#identities.resolve(entryId, generation);
      if (!resolved) return this.#viewRefusal("navigate", "invalid_entry_id");
      if (resolved.role !== "visible-entry" && resolved.role !== "parent-cursor") {
        return this.#viewRefusal("navigate", "invalid_entry_id");
      }
      if (resolved.kind === "reparse") return this.#viewRefusal("navigate", "reparse_refused");
      if (resolved.kind !== "directory") return this.#viewRefusal("navigate", "path_rejected");
      target = resolved.canonicalPath;
    }

    try {
      const stat = await this.#filesystem.lstat(target);
      if (stat.isReparse || stat.kind === "reparse") return this.#viewRefusal("navigate", "reparse_refused");
      if (stat.kind !== "directory") return this.#viewRefusal("navigate", "path_rejected");
      target = await this.#filesystem.realpath(target);
      if (!this.#filesystem.isWithin(this.#rootPath, target)) return this.#viewRefusal("navigate", "path_rejected");
    } catch { return this.#viewFailure("navigate", "directory_read_failed"); }
    return this.#publish("navigate", target) as Promise<ViewCommandResult>;
  }

  async setDestination(
    generation: number,
    request: SetDestinationRequest,
  ): Promise<DestinationCommandResult> {
    if (!this.#snapshot || !this.#rootPath || !this.#directoryPath) {
      throw new Error("no root selected");
    }
    if (generation !== this.#snapshot.generation) {
      return {
        operation: "set-destination",
        status: "refused",
        code: "stale_generation",
        snapshot: { state: "unchanged", snapshot: this.#snapshot },
        evidencePath: this.#evidencePath,
      };
    }

    let nextPin: PinnedDestination;
    if (request.mode === "clear") {
      nextPin = null;
    } else if (request.mode === "selected-root") {
      nextPin = {
        canonicalPath: this.#rootPath,
        displayName: this.#rootDisplayName as string,
        isRoot: true,
      };
    } else if (request.mode === "visible-entry") {
      const visible = this.#snapshot.entries.find((entry) => entry.entryId === request.entryId);
      if (visible?.kind === "reparse") return this.#destinationRefusal("reparse_refused");
      const resolved = this.#identities.resolve(request.entryId, generation);
      if (!visible || visible.kind !== "directory" || !resolved || resolved.role !== "visible-entry") {
        return this.#destinationRefusal("invalid_entry_id");
      }
      const refusal = await this.#revalidateDestination(resolved.canonicalPath);
      if (refusal !== null) return this.#destinationRefusal(refusal);
      nextPin = {
        canonicalPath: resolved.canonicalPath,
        displayName: visible.name,
        isRoot: false,
      };
    } else {
      return this.#destinationRefusal("invalid_argument");
    }

    const previous = this.#pinnedDestination;
    this.#pinnedDestination = nextPin;
    const result = await this.#publish("set-destination", this.#directoryPath);
    if (result.status === "failed") this.#pinnedDestination = previous;
    return result as DestinationCommandResult;
  }

  refuseViewCommand(operation: "navigate" | "refresh", code: "invalid_argument"): ViewCommandResult {
    if (!this.#snapshot) return this.#viewFailure(operation, "root_removed");
    return this.#viewRefusal(operation, code);
  }

  refuseDestinationCommand(code: "invalid_argument"): DestinationCommandResult {
    if (!this.#snapshot) throw new Error("no root selected");
    return this.#destinationRefusal(code);
  }

  async setSelection(generation: number, items: SelectionRequestItem[]): Promise<SelectionResult> {
    if (!this.#snapshot) throw new Error("no root selected");
    if (generation !== this.#snapshot.generation) {
      return this.#refusedSelection(items, "cross_generation_entry_id");
    }
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.submittedEntryId !== null) counts.set(item.submittedEntryId, (counts.get(item.submittedEntryId) ?? 0) + 1);
    }
    const codes = items.map((item) => {
      if (item.submittedEntryId === null) return "missing_entry_id" as const;
      if ((counts.get(item.submittedEntryId) ?? 0) > 1) return "duplicate_entry_id" as const;
      if (!this.#snapshot!.entries.some((entry) => entry.entryId === item.submittedEntryId)) {
        return "unknown_entry_id" as const;
      }
      const classification = this.#identities.classify(item.submittedEntryId, generation);
      return classification === "current" ? null
        : classification === "cross_generation" ? "cross_generation_entry_id" as const
          : "unknown_entry_id" as const;
    });
    if (codes.some((code) => code !== null)) {
      const outcomes: RefusedSelectionItemOutcome[] = items.map((item, index) => ({
        ordinal: item.ordinal,
        submittedEntryId: item.submittedEntryId,
        status: "refused",
        code: codes[index] ?? "unknown_entry_id",
      }));
      return {
        status: "refused",
        code: "invalid_entry_id",
        outcomes,
        priorSelectedEntryIds: [...this.#selectedEntryIds],
        currentSnapshot: this.#snapshot,
        evidencePath: this.#evidencePath,
      };
    }
    const outcomes = items.map((item) => ({
      ordinal: item.ordinal,
      status: "accepted" as const,
      entryId: this.#identities.resolve(item.submittedEntryId as string, generation)!.entryId,
    }));
    this.#selectedEntryIds = outcomes.map((outcome) => outcome.entryId);
    return {
      status: "accepted",
      outcomes,
      currentSnapshot: this.#snapshot,
      evidencePath: this.#evidencePath,
    };
  }

  #refusedSelection(
    items: SelectionRequestItem[],
    code: "missing_entry_id" | "duplicate_entry_id" | "unknown_entry_id" | "cross_generation_entry_id",
  ): SelectionResult {
    return {
      status: "refused",
      code: "stale_generation",
      outcomes: items.map((item) => ({
        ordinal: item.ordinal,
        submittedEntryId: item.submittedEntryId,
        status: "refused",
        code,
      })),
      priorSelectedEntryIds: [...this.#selectedEntryIds],
      currentSnapshot: this.#snapshot as DirectorySnapshot,
      evidencePath: this.#evidencePath,
    };
  }

  async #publish(
    operation: "navigate" | "refresh" | "set-destination",
    directoryPath: string,
  ): Promise<ViewCommandResult | DestinationCommandResult> {
    const generation = this.#lastGeneration + 1;
    const result = await this.#snapshots.build({
      rootPath: this.#rootPath as string,
      rootId: this.#rootId as string,
      rootDisplayName: this.#rootDisplayName as string,
      directoryPath,
      generation,
      evidencePath: this.#evidencePath,
    });
    if (result.status === "failed") {
      return {
        operation,
        status: "failed",
        code: result.code,
        snapshot: result.snapshot,
        evidencePath: this.#evidencePath,
      };
    }
    this.#directoryPath = directoryPath;
    this.#snapshot = await this.#projectDestination(result.snapshot.snapshot);
    this.#lastGeneration = generation;
    this.#selectedEntryIds = [];
    return {
      operation,
      status: "accepted",
      snapshot: { state: "current", snapshot: this.#snapshot },
      evidencePath: this.#evidencePath,
    };
  }

  #viewRefusal(operation: "navigate" | "refresh", code: "invalid_argument" | "stale_generation" | "invalid_entry_id" | "reparse_refused" | "path_rejected" | "navigate_above_root"): ViewCommandResult {
    return {
      operation,
      status: "refused",
      code,
      snapshot: { state: "unchanged", snapshot: this.#snapshot as DirectorySnapshot },
      evidencePath: this.#evidencePath,
    };
  }

  #viewFailure(operation: "navigate" | "refresh", code: "root_removed" | "directory_read_failed"): ViewCommandResult {
    return {
      operation,
      status: "failed",
      code,
      snapshot: {
        state: "unavailable",
        snapshot: null,
        lastPublishedGeneration: this.#lastGeneration,
        code: code === "directory_read_failed" ? "snapshot_read_failed" : code,
      },
      evidencePath: this.#evidencePath,
    };
  }

  #destinationRefusal(code: "invalid_argument" | "invalid_entry_id" | "stale_generation" | "reparse_refused" | "path_rejected"): DestinationCommandResult {
    return {
      operation: "set-destination",
      status: "refused",
      code,
      snapshot: { state: "unchanged", snapshot: this.#snapshot as DirectorySnapshot },
      evidencePath: this.#evidencePath,
    };
  }

  async #revalidateDestination(subject: string): Promise<"reparse_refused" | "path_rejected" | null> {
    try {
      const stat = await this.#filesystem.lstat(subject);
      if (stat.isReparse || stat.kind === "reparse") return "reparse_refused";
      if (stat.kind !== "directory") return "path_rejected";
      const canonical = await this.#filesystem.realpath(subject);
      if (!this.#filesystem.isWithin(this.#rootPath as string, canonical)) return "path_rejected";
      return null;
    } catch { return "path_rejected"; }
  }

  async #projectDestination(snapshot: DirectorySnapshot): Promise<DirectorySnapshot> {
    const pin = this.#pinnedDestination;
    if (pin === null) return { ...snapshot, destinationProjection: { state: "none" } };
    let projection: DestinationProjection;
    try {
      const stat = await this.#filesystem.lstat(pin.canonicalPath);
      if (stat.isReparse || stat.kind === "reparse") {
        projection = {
          state: "unavailable",
          entryId: null,
          displayName: pin.displayName,
          code: "destination_reparse",
        };
      } else if (stat.kind !== "directory") {
        projection = {
          state: "unavailable",
          entryId: null,
          displayName: pin.displayName,
          code: "destination_unavailable",
        };
      } else {
        const canonical = await this.#filesystem.realpath(pin.canonicalPath);
        if (!this.#filesystem.isWithin(this.#rootPath as string, canonical)) {
          projection = {
            state: "unavailable",
            entryId: null,
            displayName: pin.displayName,
            code: "destination_unavailable",
          };
        } else {
          projection = {
            state: "current",
            entryId: this.#identities.issue(canonical, "directory", "pinned-destination"),
            displayName: pin.displayName,
            isRoot: pin.isRoot,
          };
        }
      }
    } catch {
      projection = {
        state: "unavailable",
        entryId: null,
        displayName: pin.displayName,
        code: "destination_unavailable",
      };
    }
    return { ...snapshot, destinationProjection: projection };
  }

}
