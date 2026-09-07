import type {
  CreateDirectoryResult,
  EntryOutcome,
  ExecutionFailureCode,
  MutationOperation,
  MutationRequestItem,
  MutationResult,
  RefusalCode,
  SnapshotResult,
} from "../sms/file-manager-contract";
import type {
  FilesystemPort,
  IdentityPort,
  IdentityResolution,
  MutationContext,
  MutationSessionPort,
  NameValidationPort,
  RecyclePort,
} from "../sms/file-manager-ports";

export interface BatchOperationDependencies {
  filesystem: FilesystemPort;
  recycle: RecyclePort;
  identities: IdentityPort;
  session: MutationSessionPort;
  validateName: NameValidationPort;
}

interface ItemPreflight {
  context: MutationContext;
  resolutions: Array<IdentityResolution | null>;
  refusalCodes: Array<RefusalCode | null>;
}

export class BatchOperationOrchestrator {
  readonly #filesystem: FilesystemPort;
  readonly #recycle: RecyclePort;
  readonly #identities: IdentityPort;
  readonly #session: MutationSessionPort;
  readonly #validateName: NameValidationPort;

  constructor(dependencies: BatchOperationDependencies) {
    this.#filesystem = dependencies.filesystem;
    this.#recycle = dependencies.recycle;
    this.#identities = dependencies.identities;
    this.#session = dependencies.session;
    this.#validateName = dependencies.validateName;
  }

  async createDirectory(
    generation: number,
    parentEntryId: string | null,
    name: unknown,
  ): Promise<CreateDirectoryResult> {
    const context = this.#requireContext();
    const requestedName = typeof name === "string" ? name : "";
    if (generation !== context.snapshot.generation) {
      return this.#createRefusal(requestedName, "stale_generation", context);
    }
    const validated = this.#validateName(name);
    if (!validated.ok) return this.#createRefusal(requestedName, validated.code, context);

    let parentPath = context.directoryPath;
    if (parentEntryId !== null) {
      if (parentEntryId !== context.snapshot.directoryId) {
        return this.#createRefusal(requestedName, "invalid_entry_id", context);
      }
      const parent = this.#identities.resolve(parentEntryId, generation);
      if (!parent || parent.kind !== "directory" || parent.role !== "directory-cursor") {
        return this.#createRefusal(requestedName, "invalid_entry_id", context);
      }
      const refusal = await this.#revalidate(parent, context.rootPath, "directory");
      if (refusal) return this.#createRefusal(requestedName, refusal, context);
      parentPath = parent.canonicalPath;
    }
    const target = this.#filesystem.join(parentPath, validated.value);
    if (!this.#filesystem.isWithin(context.rootPath, target)) {
      return this.#createRefusal(requestedName, "path_rejected", context);
    }
    try {
      if (await this.#filesystem.exists(target)) {
        return this.#createRefusal(requestedName, "conflict", context);
      }
      await this.#filesystem.createDirectory(target);
    } catch {
      return {
        status: "failed",
        requestedName,
        code: "filesystem_operation_failed",
        snapshot: this.#unchanged(context),
        evidencePath: context.evidencePath,
      };
    }
    const snapshot = await this.#session.publishAfterMutation();
    return {
      status: "accepted",
      createdName: validated.value,
      snapshot: snapshot.state === "unchanged"
        ? { state: "unavailable", snapshot: null, lastPublishedGeneration: context.snapshot.generation, code: "snapshot_read_failed" }
        : snapshot,
      evidencePath: context.evidencePath,
    };
  }

  async rename(generation: number, items: MutationRequestItem[], name: unknown): Promise<MutationResult> {
    const context = this.#requireContext();
    const validated = this.#validateName(name);
    if (!validated.ok || items.length !== 1) {
      return this.#refuseAll("rename", items, context,
        items.map(() => validated.ok ? "invalid_argument" : validated.code));
    }
    const preflight = await this.#preflight(generation, items, context);
    if (preflight.refusalCodes.some(Boolean)) {
      return this.#refuseAll("rename", items, context, preflight.refusalCodes);
    }
    const resolution = preflight.resolutions[0] as IdentityResolution;
    const target = this.#filesystem.join(this.#filesystem.parent(resolution.canonicalPath), validated.value);
    if (!this.#filesystem.isWithin(context.rootPath, target) || await this.#filesystem.exists(target)) {
      return this.#refuseAll("rename", items, context, [
        this.#filesystem.isWithin(context.rootPath, target) ? "conflict" : "path_rejected",
      ]);
    }
    const outcome = await this.#executeOne("rename", items[0], resolution, context, async () => {
      await this.#filesystem.rename(resolution.canonicalPath, target);
    });
    return this.#finish("rename", [outcome], context);
  }

  async copy(
    generation: number,
    items: MutationRequestItem[],
    destinationDirectoryId: string | null,
  ): Promise<MutationResult> {
    return this.#transfer("copy", generation, items, destinationDirectoryId);
  }

  async move(
    generation: number,
    items: MutationRequestItem[],
    destinationDirectoryId: string | null,
  ): Promise<MutationResult> {
    return this.#transfer("move", generation, items, destinationDirectoryId);
  }

  async trash(generation: number, items: MutationRequestItem[]): Promise<MutationResult> {
    const context = this.#requireContext();
    const preflight = await this.#preflight(generation, items, context);
    if (preflight.refusalCodes.some(Boolean)) {
      return this.#refuseAll("trash", items, context, preflight.refusalCodes);
    }
    const outcomes: EntryOutcome[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const resolution = preflight.resolutions[index] as IdentityResolution;
      outcomes.push(await this.#executeOne("trash", item, resolution, context, async () => {
        await this.#recycle.recycle(resolution.canonicalPath);
      }));
    }
    return this.#finish("trash", outcomes, context);
  }

  async #transfer(
    operation: "copy" | "move",
    generation: number,
    items: MutationRequestItem[],
    destinationDirectoryId: string | null,
  ): Promise<MutationResult> {
    const context = this.#requireContext();
    const preflight = await this.#preflight(generation, items, context);
    if (preflight.refusalCodes.some(Boolean)) {
      return this.#refuseAll(operation, items, context, preflight.refusalCodes);
    }
    let destinationPath = context.directoryPath;
    if (destinationDirectoryId !== null) {
      if (context.snapshot.destinationProjection.state !== "current"
          || context.snapshot.destinationProjection.entryId !== destinationDirectoryId) {
        return this.#refuseAll(operation, items, context, items.map(() => "invalid_entry_id"));
      }
      const destination = this.#identities.resolve(destinationDirectoryId, generation);
      if (!destination || destination.kind !== "directory" || destination.role !== "pinned-destination") {
        return this.#refuseAll(operation, items, context, items.map(() => "invalid_entry_id"));
      }
      const destinationRefusal = await this.#revalidate(destination, context.rootPath, "directory");
      if (destinationRefusal) {
        return this.#refuseAll(operation, items, context, items.map(() => destinationRefusal));
      }
      destinationPath = destination.canonicalPath;
    }

    const targets = (preflight.resolutions as IdentityResolution[]).map((resolution) =>
      this.#filesystem.join(destinationPath, this.#filesystem.baseName(resolution.canonicalPath)));
    const conflictCodes: Array<RefusalCode | null> = [];
    for (let index = 0; index < targets.length; index += 1) {
      const resolution = preflight.resolutions[index] as IdentityResolution;
      const target = targets[index];
      if (!this.#filesystem.isWithin(context.rootPath, target)
          || (resolution.kind === "directory" && this.#filesystem.isWithin(resolution.canonicalPath, destinationPath))) {
        conflictCodes.push("path_rejected");
      } else if (await this.#filesystem.exists(target)) {
        conflictCodes.push("conflict");
      } else conflictCodes.push(null);
    }
    if (conflictCodes.some(Boolean)) {
      return this.#refuseAll(operation, items, context, conflictCodes);
    }

    const outcomes: EntryOutcome[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const resolution = preflight.resolutions[index] as IdentityResolution;
      const target = targets[index];
      outcomes.push(await this.#executeOne(operation, item, resolution, context, async () => {
        const destinationStat = await this.#filesystem.lstat(destinationPath);
        if (destinationStat.isReparse || destinationStat.kind !== "directory") {
          throw Object.assign(new Error("destination changed"), { refusalCode: "reparse_refused" });
        }
        if (await this.#filesystem.exists(target)) {
          throw Object.assign(new Error("destination conflict"), { refusalCode: "conflict" });
        }
        if (operation === "copy") await this.#filesystem.copy(resolution.canonicalPath, target);
        else await this.#filesystem.move(resolution.canonicalPath, target);
      }));
    }
    return this.#finish(operation, outcomes, context);
  }

  async #preflight(
    generation: number,
    items: MutationRequestItem[],
    context: MutationContext,
  ): Promise<ItemPreflight> {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.submittedEntryId !== null) {
        counts.set(item.submittedEntryId, (counts.get(item.submittedEntryId) ?? 0) + 1);
      }
    }
    const resolutions: Array<IdentityResolution | null> = [];
    const refusalCodes: Array<RefusalCode | null> = [];
    for (const item of items) {
      if (generation !== context.snapshot.generation) {
        resolutions.push(null); refusalCodes.push("stale_generation"); continue;
      }
      if (item.submittedEntryId === null) {
        resolutions.push(null); refusalCodes.push("invalid_entry_id"); continue;
      }
      if ((counts.get(item.submittedEntryId) ?? 0) > 1) {
        resolutions.push(null); refusalCodes.push("duplicate_entry_id"); continue;
      }
      if (!context.snapshot.entries.some((entry) => entry.entryId === item.submittedEntryId)) {
        resolutions.push(null); refusalCodes.push("invalid_entry_id"); continue;
      }
      const classification = this.#identities.classify(item.submittedEntryId, generation);
      if (classification !== "current") {
        resolutions.push(null);
        refusalCodes.push(classification === "cross_generation" ? "stale_generation" : "invalid_entry_id");
        continue;
      }
      const resolution = this.#identities.resolve(item.submittedEntryId, generation);
      if (!resolution || resolution.role !== "visible-entry") {
        resolutions.push(null); refusalCodes.push("invalid_entry_id"); continue;
      }
      const refusal = await this.#revalidate(resolution, context.rootPath);
      resolutions.push(resolution);
      refusalCodes.push(refusal);
    }
    return { context, resolutions, refusalCodes };
  }

  async #revalidate(
    resolution: IdentityResolution,
    rootPath: string,
    requiredKind?: "directory",
  ): Promise<RefusalCode | null> {
    try {
      const stat = await this.#filesystem.lstat(resolution.canonicalPath);
      if (stat.isReparse || stat.kind === "reparse") return "reparse_refused";
      if (requiredKind && stat.kind !== requiredKind) return "path_rejected";
      const canonical = await this.#filesystem.realpath(resolution.canonicalPath);
      if (!this.#filesystem.isWithin(rootPath, canonical)) return "path_rejected";
      if (stat.kind !== resolution.kind) return "invalid_entry_id";
      return null;
    } catch { return "invalid_entry_id"; }
  }

  async #executeOne(
    operation: MutationOperation,
    item: MutationRequestItem,
    resolution: IdentityResolution,
    context: MutationContext,
    action: () => Promise<void>,
  ): Promise<EntryOutcome> {
    const refusal = await this.#revalidate(resolution, context.rootPath);
    if (refusal) {
      return { ordinal: item.ordinal, submittedEntryId: item.submittedEntryId, status: "refused", code: refusal };
    }
    try {
      await action();
      return { ordinal: item.ordinal, entryId: resolution.entryId, status: "accepted" };
    } catch (error) {
      const refusalCode = (error as { refusalCode?: RefusalCode }).refusalCode;
      if (refusalCode) {
        return { ordinal: item.ordinal, submittedEntryId: item.submittedEntryId, status: "refused", code: refusalCode };
      }
      const code: ExecutionFailureCode = operation === "trash"
        ? "recycle_failed" : "filesystem_operation_failed";
      return { ordinal: item.ordinal, entryId: resolution.entryId, status: "failed", code };
    }
  }

  async #finish(
    operation: MutationOperation,
    outcomes: EntryOutcome[],
    context: MutationContext,
  ): Promise<MutationResult> {
    const accepted = outcomes.filter((outcome) => outcome.status === "accepted").length;
    const failed = outcomes.some((outcome) => outcome.status === "failed");
    const overallStatus = accepted === outcomes.length && accepted > 0
      ? "accepted"
      : accepted > 0
        ? "partial"
        : failed
          ? "failed"
          : "refused";
    const snapshot: SnapshotResult = accepted > 0
      ? await this.#session.publishAfterMutation()
      : this.#unchanged(context);
    return { operation, overallStatus, outcomes, snapshot, evidencePath: context.evidencePath };
  }

  #refuseAll(
    operation: MutationOperation,
    items: MutationRequestItem[],
    context: MutationContext,
    codes: Array<RefusalCode | null>,
  ): MutationResult {
    const outcomes: EntryOutcome[] = items.map((item, index) => ({
      ordinal: item.ordinal,
      submittedEntryId: item.submittedEntryId,
      status: "refused",
      code: codes[index] ?? "invalid_argument",
    }));
    return {
      operation,
      overallStatus: "refused",
      outcomes,
      snapshot: this.#unchanged(context),
      evidencePath: context.evidencePath,
    };
  }

  #createRefusal(
    requestedName: string,
    code: RefusalCode,
    context: MutationContext,
  ): CreateDirectoryResult {
    return {
      status: "refused",
      requestedName,
      code,
      snapshot: this.#unchanged(context),
      evidencePath: context.evidencePath,
    };
  }

  #unchanged(context: MutationContext): Extract<SnapshotResult, { state: "unchanged" }> {
    return { state: "unchanged", snapshot: context.snapshot };
  }

  #requireContext(): MutationContext {
    const context = this.#session.mutationContext();
    if (!context) throw new Error("no root selected");
    return context;
  }
}
