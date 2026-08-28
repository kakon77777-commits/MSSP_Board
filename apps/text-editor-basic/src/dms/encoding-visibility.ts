import type { BoundarySnapshot, DocumentRefusal } from "../sms/document-format-contract";

const ABSENT = "-";
const UNTITLED = "untitled";

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element !== null) {
    element.textContent = text;
  }
}

function setDataDirty(value: "true" | "false"): void {
  const element = document.getElementById("dirty");
  if (element !== null) {
    element.setAttribute("data-dirty", value);
  }
}

/**
 * Projects an already-decided boundary snapshot (and any refusal) onto the DOM.
 * It decides nothing: it only writes the values it was handed. Every target
 * element may be absent; missing elements are skipped without error, warning,
 * or element creation.
 */
export function renderBoundary(snapshot: BoundarySnapshot | null, refusal: DocumentRefusal | null): void {
  if (snapshot === null) {
    setText("encoding", ABSENT);
    setText("bom", ABSENT);
    setText("eol", ABSENT);
    setText("name", ABSENT);
    setText("bytes", ABSENT);
    setText("generation", ABSENT);
    setDataDirty("false");
  } else {
    setText("encoding", snapshot.format.encoding);
    setText("bom", snapshot.format.bom === "present" ? "BOM" : "No BOM");
    setText("eol", snapshot.format.eol.toUpperCase());
    setText("name", snapshot.fileName ?? UNTITLED);
    setText(
      "bytes",
      snapshot.format.rawByteLength === null ? ABSENT : String(snapshot.format.rawByteLength),
    );
    setText("generation", String(snapshot.boundaryGeneration));
    setDataDirty(snapshot.dirty ? "true" : "false");
  }
  setText("error", refusal === null ? "" : refusal.message);
}