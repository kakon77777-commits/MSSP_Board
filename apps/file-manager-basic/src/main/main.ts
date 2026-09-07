import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WindowsFilesystemAdapter } from "../fms/windows-filesystem-adapter";
import { WindowsRecycleAdapter } from "../fms/windows-recycle-adapter";
import { WindowsRootPickerAdapter } from "../fms/windows-root-picker-adapter";
import type {
  DirectoryObservationResult,
  MutationRequestItem,
  SelectionRequestItem,
  SetDestinationRequest,
} from "../sms/file-manager-contract";
import type { SnapshotBuildInput, SnapshotPort } from "../sms/file-manager-ports";
import { BatchOperationOrchestrator } from "../tms/batch-operation-orchestrator";
import { DirectorySnapshotBuilder } from "../tms/directory-snapshot-builder";
import { EntryIdRegistry } from "../tms/entry-id-registry";
import { RootSessionController } from "../tms/root-session-controller";
import { validateSingleSegmentName } from "../tms/single-segment-name-validator";
import { isNavigationAllowed, windowOptions } from "./security";

class FaultInjectingSnapshotPort implements SnapshotPort {
  #calls = 0;
  constructor(
    private readonly inner: SnapshotPort,
    private readonly failAt: number | null,
  ) {}

  async build(input: SnapshotBuildInput): Promise<DirectoryObservationResult> {
    this.#calls += 1;
    if (this.failAt !== null && this.#calls === this.failAt) {
      return {
        status: "failed",
        code: "snapshot_read_failed",
        snapshot: {
          state: "unavailable",
          snapshot: null,
          lastPublishedGeneration: Math.max(0, input.generation - 1),
          code: "snapshot_read_failed",
        },
        evidencePath: "stubbed",
      };
    }
    return this.inner.build(input);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const isGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isNullableId = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function parseItems(value: unknown): MutationRequestItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: MutationRequestItem[] = [];
  const ordinals = new Set<number>();
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["ordinal", "submittedEntryId"])
        || !Number.isSafeInteger(item.ordinal) || (item.ordinal as number) < 0
        || !isNullableId(item.submittedEntryId) || ordinals.has(item.ordinal as number)) return null;
    ordinals.add(item.ordinal as number);
    items.push({ ordinal: item.ordinal as number, submittedEntryId: item.submittedEntryId });
  }
  return items;
}

function parseDestinationRequest(value: unknown): SetDestinationRequest | null {
  if (!isRecord(value) || typeof value.mode !== "string") return null;
  if (value.mode === "visible-entry") {
    return exactKeys(value, ["mode", "entryId"]) && typeof value.entryId === "string"
      ? { mode: "visible-entry", entryId: value.entryId }
      : null;
  }
  if (value.mode === "selected-root" || value.mode === "clear") {
    return exactKeys(value, ["mode"]) ? { mode: value.mode } : null;
  }
  return null;
}

function createServices() {
  const filesystem = new WindowsFilesystemAdapter();
  const identities = new EntryIdRegistry(randomUUID);
  const baseSnapshots = new DirectorySnapshotBuilder(filesystem, identities);
  const failAtRaw = process.env.MSSP_FM_FAIL_SCAN_AT;
  const failAt = failAtRaw && /^\d+$/.test(failAtRaw) ? Number(failAtRaw) : null;
  const snapshots = new FaultInjectingSnapshotPort(baseSnapshots, failAt);
  const pickerOptions = Object.hasOwn(process.env, "MSSP_FM_STUB_ROOT")
    ? { stubSelection: process.env.MSSP_FM_STUB_ROOT === "__CANCEL__" ? null : process.env.MSSP_FM_STUB_ROOT }
    : {};
  const picker = new WindowsRootPickerAdapter(pickerOptions);
  const session = new RootSessionController({
    picker,
    filesystem,
    snapshots,
    identities,
    rootToken: randomUUID,
  });
  const operations = new BatchOperationOrchestrator({
    filesystem,
    recycle: new WindowsRecycleAdapter(),
    identities,
    session,
    validateName: validateSingleSegmentName,
  });
  return { session, operations };
}

function registerHandlers(): void {
  const { session, operations } = createServices();
  ipcMain.handle("file-manager:choose-root", () => session.chooseRoot());
  ipcMain.handle("file-manager:get-current-directory", () => session.getCurrentDirectory());
  ipcMain.handle("file-manager:navigate", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "entryId"])
        || !isGeneration(value.generation) || !isNullableId(value.entryId)) {
      return session.refuseViewCommand("navigate", "invalid_argument");
    }
    return session.navigate(value.generation, value.entryId);
  });
  ipcMain.handle("file-manager:refresh", () => session.refresh());
  ipcMain.handle("file-manager:set-selection", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "items"])
        || !isGeneration(value.generation)) throw new TypeError("invalid selection request");
    const items = parseItems(value.items) as SelectionRequestItem[] | null;
    if (!items) throw new TypeError("invalid selection items");
    return session.setSelection(value.generation, items);
  });
  ipcMain.handle("file-manager:set-destination", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "request"])
        || !isGeneration(value.generation)) throw new TypeError("invalid destination request");
    const request = parseDestinationRequest(value.request);
    if (!request) return session.refuseDestinationCommand("invalid_argument");
    return session.setDestination(value.generation, request);
  });
  ipcMain.handle("file-manager:create-directory", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "parentEntryId", "name"])
        || !isGeneration(value.generation) || !isNullableId(value.parentEntryId)) {
      throw new TypeError("invalid create request");
    }
    return operations.createDirectory(value.generation, value.parentEntryId, value.name);
  });
  ipcMain.handle("file-manager:rename", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "items", "name"])
        || !isGeneration(value.generation)) throw new TypeError("invalid rename request");
    const items = parseItems(value.items);
    if (!items) throw new TypeError("invalid rename items");
    return operations.rename(value.generation, items, value.name);
  });
  ipcMain.handle("file-manager:copy", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "items", "destinationDirectoryId"])
        || !isGeneration(value.generation) || !isNullableId(value.destinationDirectoryId)) {
      throw new TypeError("invalid copy request");
    }
    const items = parseItems(value.items);
    if (!items) throw new TypeError("invalid copy items");
    return operations.copy(value.generation, items, value.destinationDirectoryId);
  });
  ipcMain.handle("file-manager:move", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "items", "destinationDirectoryId"])
        || !isGeneration(value.generation) || !isNullableId(value.destinationDirectoryId)) {
      throw new TypeError("invalid move request");
    }
    const items = parseItems(value.items);
    if (!items) throw new TypeError("invalid move items");
    return operations.move(value.generation, items, value.destinationDirectoryId);
  });
  ipcMain.handle("file-manager:trash", (_event, value: unknown) => {
    if (!isRecord(value) || !exactKeys(value, ["generation", "items"])
        || !isGeneration(value.generation)) throw new TypeError("invalid trash request");
    const items = parseItems(value.items);
    if (!items) throw new TypeError("invalid trash items");
    return operations.trash(value.generation, items);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(windowOptions());
  const renderer = path.join(__dirname, "..", "renderer", "index.html");
  const rendererUrl = pathToFileURL(renderer).href;
  window.webContents.on("will-navigate", (event, target) => {
    if (!isNavigationAllowed(target)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(rendererUrl);
  window.once("ready-to-show", () => window.show());
  return window;
}

void app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
