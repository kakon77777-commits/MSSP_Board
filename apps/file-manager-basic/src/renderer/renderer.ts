import type {
  CreateDirectoryResult,
  DirectoryObservationResult,
  DirectorySnapshot,
  DestinationCommandResult,
  MutationRequestItem,
  MutationResult,
  RootSelectionResult,
  SetDestinationRequest,
  SelectionRequestItem,
  SelectionResult,
  ViewCommandResult,
} from "../sms/file-manager-contract";
import {
  renderCreateDirectory,
  renderDirectoryObservation,
  renderDestinationCommand,
  renderMutation,
  renderRootSelection,
  renderSelection,
  renderUnhandledError,
  renderViewCommand,
} from "../dms/file-manager-view.js";

interface FileManagerApi {
  chooseRoot(): Promise<RootSelectionResult>;
  getCurrentDirectory(): Promise<DirectoryObservationResult>;
  navigate(generation: number, entryId: string | null): Promise<ViewCommandResult>;
  refresh(): Promise<ViewCommandResult>;
  setSelection(generation: number, items: SelectionRequestItem[]): Promise<SelectionResult>;
  setDestination(generation: number, request: SetDestinationRequest): Promise<DestinationCommandResult>;
  createDirectory(generation: number, parentEntryId: string | null, name: unknown): Promise<CreateDirectoryResult>;
  renameEntries(generation: number, items: MutationRequestItem[], name: unknown): Promise<MutationResult>;
  copyEntries(generation: number, items: MutationRequestItem[], destinationDirectoryId: string | null): Promise<MutationResult>;
  moveEntries(generation: number, items: MutationRequestItem[], destinationDirectoryId: string | null): Promise<MutationResult>;
  trashEntries(generation: number, items: MutationRequestItem[]): Promise<MutationResult>;
}

const host = window as unknown as {
  fileManager: FileManagerApi;
  __lastFileManagerResult?: unknown;
};
let snapshot: DirectorySnapshot | null = null;

function capture(result: unknown): void {
  host.__lastFileManagerResult = result;
}

function updateSnapshot(result: RootSelectionResult | DirectoryObservationResult | ViewCommandResult | DestinationCommandResult | CreateDirectoryResult | MutationResult): void {
  if ("status" in result && result.status === "accepted" && "snapshot" in result) {
    const value = result.snapshot;
    if ("schema" in value) snapshot = value;
    else if (value.state !== "unavailable") snapshot = value.snapshot;
    return;
  }
  if ("overallStatus" in result && result.snapshot.state !== "unavailable") snapshot = result.snapshot.snapshot;
  if ("status" in result && result.status === "observed") snapshot = result.snapshot.snapshot;
}

async function perform<T>(action: () => Promise<T>, render: (result: T) => void): Promise<void> {
  try {
    const result = await action();
    capture(result);
    render(result);
    if (typeof result === "object" && result !== null) updateSnapshot(result as never);
  } catch (error) { renderUnhandledError(error); }
}

function currentGeneration(): number {
  if (!snapshot) throw new Error("no root selected");
  return snapshot.generation;
}

function selectionItems(): MutationRequestItem[] {
  return [...document.querySelectorAll<HTMLInputElement>("#entries input.entry-select:checked")]
    .map((input, ordinal) => ({ ordinal, submittedEntryId: input.dataset.entryId ?? null }));
}

document.querySelector("#choose-root")?.addEventListener("click", () => {
  void perform(() => host.fileManager.chooseRoot(), renderRootSelection);
});
document.querySelector("#navigate-parent")?.addEventListener("click", () => {
  void perform(() => host.fileManager.navigate(currentGeneration(), null), renderViewCommand);
});
document.querySelector("#refresh")?.addEventListener("click", () => {
  void perform(() => host.fileManager.refresh(), renderViewCommand);
});
document.querySelector("#create-directory")?.addEventListener("click", () => {
  const name = (document.querySelector<HTMLInputElement>("#name-input"))?.value ?? "";
  void perform(() => host.fileManager.createDirectory(currentGeneration(), snapshot?.directoryId ?? null, name), renderCreateDirectory);
});
document.querySelector("#set-destination")?.addEventListener("click", () => {
  const raw = (document.querySelector<HTMLSelectElement>("#pin-target"))?.value ?? "clear";
  const request: SetDestinationRequest = raw === "selected-root"
    ? { mode: "selected-root" }
    : raw === "clear"
      ? { mode: "clear" }
      : { mode: "visible-entry", entryId: raw.slice("visible:".length) };
  void perform(() => host.fileManager.setDestination(currentGeneration(), request), renderDestinationCommand);
});
document.querySelector("#rename-entry")?.addEventListener("click", () => {
  const name = (document.querySelector<HTMLInputElement>("#name-input"))?.value ?? "";
  void perform(() => host.fileManager.renameEntries(currentGeneration(), selectionItems(), name), renderMutation);
});
document.querySelector("#copy-entries")?.addEventListener("click", () => {
  const destination = (document.querySelector<HTMLSelectElement>("#destination"))?.value || null;
  void perform(() => host.fileManager.copyEntries(currentGeneration(), selectionItems(), destination), renderMutation);
});
document.querySelector("#move-entries")?.addEventListener("click", () => {
  const destination = (document.querySelector<HTMLSelectElement>("#destination"))?.value || null;
  void perform(() => host.fileManager.moveEntries(currentGeneration(), selectionItems(), destination), renderMutation);
});
document.querySelector("#trash-entries")?.addEventListener("click", () => {
  void perform(() => host.fileManager.trashEntries(currentGeneration(), selectionItems()), renderMutation);
});

document.querySelector("#entries")?.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLButtonElement && target.classList.contains("entry-open")) {
    void perform(() => host.fileManager.navigate(currentGeneration(), target.dataset.entryId ?? null), renderViewCommand);
  }
});
document.querySelector("#entries")?.addEventListener("change", () => {
  const items = selectionItems();
  void perform(() => host.fileManager.setSelection(currentGeneration(), items), renderSelection);
});

void perform(() => host.fileManager.getCurrentDirectory(), renderDirectoryObservation);
