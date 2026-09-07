import type {
  CreateDirectoryResult,
  DirectoryObservationResult,
  DirectorySnapshot,
  DestinationCommandResult,
  MutationResult,
  RootSelectionResult,
  SelectionResult,
  SnapshotResult,
  ViewCommandResult,
} from "../sms/file-manager-contract";

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(id: string, value: string): void {
  const target = element(id);
  if (target) target.textContent = value;
}

function snapshotFrom(result: SnapshotResult): DirectorySnapshot | null {
  return result.state === "unavailable" ? null : result.snapshot;
}

export function renderSnapshot(snapshot: DirectorySnapshot): void {
  setText("root-label", snapshot.root.displayName);
  setText("generation", String(snapshot.generation));
  setText("completeness", snapshot.completeness);
  const list = element<HTMLUListElement>("entries");
  const destination = element<HTMLSelectElement>("destination");
  const pinTarget = element<HTMLSelectElement>("pin-target");
  if (list) list.replaceChildren();
  if (destination) {
    const current = document.createElement("option");
    current.value = "";
    current.textContent = "Current directory";
    destination.replaceChildren(current);
  }
  if (pinTarget) {
    const root = document.createElement("option");
    root.value = "selected-root";
    root.textContent = "Selected root";
    const clear = document.createElement("option");
    clear.value = "clear";
    clear.textContent = "Clear pin";
    pinTarget.replaceChildren(root, clear);
  }
  for (const entry of snapshot.entries) {
    if (list) {
      const row = document.createElement("li");
      row.dataset.name = entry.name;
      row.dataset.entryId = entry.entryId;
      const selection = document.createElement("input");
      selection.type = "checkbox";
      selection.className = "entry-select";
      selection.dataset.entryId = entry.entryId;
      selection.setAttribute("aria-label", `Select ${entry.name}`);
      row.append(selection);
      const label = document.createElement("span");
      label.className = "entry-name";
      label.textContent = `${entry.name} (${entry.kind})`;
      row.append(label);
      if (entry.kind === "directory") {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "entry-open";
        open.dataset.entryId = entry.entryId;
        open.textContent = "Open";
        row.append(open);
      }
      list.append(row);
    }
    if (destination && entry.kind === "directory") {
      if (pinTarget) {
        const option = document.createElement("option");
        option.value = `visible:${entry.entryId}`;
        option.textContent = entry.name;
        pinTarget.append(option);
      }
    }
  }
  const projection = snapshot.destinationProjection;
  if (projection.state === "current") {
    setText("destination-status", `${projection.displayName}${projection.isRoot ? " (root)" : ""}`);
    if (destination) {
      const option = document.createElement("option");
      option.value = projection.entryId;
      option.textContent = `${projection.displayName} (pinned)`;
      option.selected = true;
      destination.append(option);
    }
  } else if (projection.state === "unavailable") {
    setText("destination-status", `${projection.displayName} (${projection.code})`);
  } else {
    setText("destination-status", "None");
  }
}

function renderEnvelope(
  status: string,
  snapshot: SnapshotResult | null,
  evidencePath: string,
  code: string = "",
): void {
  setText("operation-status", status);
  setText("snapshot-status", snapshot?.state ?? "none");
  setText("evidence-path", evidencePath);
  setText("error-code", code);
  const current = snapshot ? snapshotFrom(snapshot) : null;
  if (current) renderSnapshot(current);
}

export function renderRootSelection(result: RootSelectionResult): void {
  if (result.status === "accepted") {
    renderEnvelope("accepted", { state: "current", snapshot: result.snapshot }, result.evidencePath);
    return;
  }
  const snapshot = result.prior
    ? { state: "unchanged" as const, snapshot: result.prior.snapshot }
    : null;
  renderEnvelope(result.status, snapshot, result.evidencePath, "code" in result ? result.code : "");
}

export function renderDirectoryObservation(result: DirectoryObservationResult): void {
  if (result.status === "observed") renderEnvelope("observed", result.snapshot, result.evidencePath);
  else renderEnvelope("failed", result.snapshot, result.evidencePath, result.code);
}

export function renderViewCommand(result: ViewCommandResult): void {
  renderEnvelope(result.status, result.snapshot, result.evidencePath,
    result.status === "accepted" ? "" : result.code);
}

export function renderDestinationCommand(result: DestinationCommandResult): void {
  renderEnvelope(result.status, result.snapshot, result.evidencePath,
    result.status === "accepted" ? "" : result.code);
}

export function renderSelection(result: SelectionResult): void {
  const selected = result.status === "accepted"
    ? result.outcomes.map((outcome) => outcome.entryId)
    : result.priorSelectedEntryIds;
  setText("selection", selected.length ? `${selected.length} selected` : "None");
  setText("operation-status", result.status);
  setText("snapshot-status", "current");
  setText("evidence-path", result.evidencePath);
  setText("error-code", result.status === "refused" ? result.code : "");
}

export function renderCreateDirectory(result: CreateDirectoryResult): void {
  renderEnvelope(result.status, result.snapshot, result.evidencePath,
    result.status === "accepted" ? "" : result.code);
}

export function renderMutation(result: MutationResult): void {
  const outcomeWithCode = result.outcomes.find((outcome) => outcome.status !== "accepted");
  const code = outcomeWithCode && "code" in outcomeWithCode
    ? outcomeWithCode.code
    : result.snapshot.state === "unavailable"
      ? result.snapshot.code
      : "";
  renderEnvelope(result.overallStatus, result.snapshot, result.evidencePath,
    code);
}

export function renderUnhandledError(error: unknown): void {
  setText("operation-status", "failed");
  setText("error-code", error instanceof Error ? error.message : String(error));
}
