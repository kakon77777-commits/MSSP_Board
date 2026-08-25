// A1 — deterministic editing state for the renderer.
//
// This is a browser script rather than a CommonJS module. The generated page
// loads it before renderer.js, and the implementer-owned development checks
// execute the same built artifact in a VM. Undo history is renderer-local; the
// main process remains authoritative for the dirty flag used by guards.

interface A1Snapshot {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

interface A1Selection {
  selectionStart: number;
  selectionEnd: number;
}

// The A1 implementation stores complete text snapshots for deterministic,
// small-surface Undo/Redo. Bound both dimensions so sustained editing of the
// preregistered 1 MiB fixture cannot retain an unbounded number of full copies.
// JavaScript strings are measured in UTF-16 code units; one oversized current
// snapshot is always retained even when it alone exceeds the byte-like budget.
const MAX_HISTORY_ENTRIES = 256;
const MAX_HISTORY_TEXT_UNITS = 32 * 1024 * 1024;

function copySnapshot(snapshot: A1Snapshot): A1Snapshot {
  return {
    text: snapshot.text,
    selectionStart: snapshot.selectionStart,
    selectionEnd: snapshot.selectionEnd,
  };
}

class EditingHistory {
  private entries: A1Snapshot[];
  private index = 0;
  private cleanText: string;
  private retainedTextUnits: number;

  constructor(text: string, selectionStart: number, selectionEnd: number) {
    this.entries = [{ text, selectionStart, selectionEnd }];
    this.cleanText = text;
    this.retainedTextUnits = text.length;
  }

  reset(snapshot: A1Snapshot): void {
    this.entries = [copySnapshot(snapshot)];
    this.index = 0;
    this.cleanText = snapshot.text;
    this.retainedTextUnits = snapshot.text.length;
  }

  current(): A1Snapshot {
    return copySnapshot(this.entries[this.index]);
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  setSelection(selectionStart: number, selectionEnd: number): void {
    const current = this.entries[this.index];
    const start = Math.max(0, Math.min(current.text.length, selectionStart));
    const end = Math.max(start, Math.min(current.text.length, selectionEnd));
    this.entries[this.index] = { ...current, selectionStart: start, selectionEnd: end };
  }

  record(snapshot: A1Snapshot): void {
    if (snapshot.text === this.entries[this.index].text) {
      this.setSelection(snapshot.selectionStart, snapshot.selectionEnd);
      return;
    }
    for (const discarded of this.entries.slice(this.index + 1)) {
      this.retainedTextUnits -= discarded.text.length;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(copySnapshot(snapshot));
    this.retainedTextUnits += snapshot.text.length;
    this.index = this.entries.length - 1;
    this.trimOldest();
  }

  private trimOldest(): void {
    while (
      this.entries.length > 1
      && (this.entries.length > MAX_HISTORY_ENTRIES
        || this.retainedTextUnits > MAX_HISTORY_TEXT_UNITS)
    ) {
      const removed = this.entries.shift();
      if (removed === undefined) return;
      this.retainedTextUnits -= removed.text.length;
      this.index -= 1;
    }
  }

  markClean(text: string = this.entries[this.index].text): void {
    this.cleanText = text;
  }

  isDirty(): boolean {
    return this.entries[this.index].text !== this.cleanText;
  }

  undo(): A1Snapshot | null {
    if (this.index === 0) return null;
    this.index -= 1;
    return copySnapshot(this.entries[this.index]);
  }

  redo(): A1Snapshot | null {
    if (this.index >= this.entries.length - 1) return null;
    this.index += 1;
    return copySnapshot(this.entries[this.index]);
  }
}

function findNext(text: string, query: string, from: number): A1Selection | null {
  if (query === "") return null;
  const start = Number.isFinite(from)
    ? Math.max(0, Math.min(text.length, Math.trunc(from)))
    : 0;
  let found = text.indexOf(query, start);
  if (found < 0 && start > 0) found = text.indexOf(query, 0);
  if (found < 0) return null;
  return { selectionStart: found, selectionEnd: found + query.length };
}

function replaceCurrentOrNext(
  snapshot: A1Snapshot,
  query: string,
  replacement: string,
): A1Snapshot | null {
  if (query === "") return null;
  const start = Math.max(0, Math.min(snapshot.text.length, snapshot.selectionStart));
  const end = Math.max(start, Math.min(snapshot.text.length, snapshot.selectionEnd));
  const selected = snapshot.text.slice(start, end);
  const match = selected === query
    ? { selectionStart: start, selectionEnd: end }
    : findNext(snapshot.text, query, end);
  if (match === null) return null;

  const text = snapshot.text.slice(0, match.selectionStart)
    + replacement
    + snapshot.text.slice(match.selectionEnd);
  const caret = match.selectionStart + replacement.length;
  return { text, selectionStart: caret, selectionEnd: caret };
}

function replaceSelection(snapshot: A1Snapshot, replacement: string): A1Snapshot {
  const start = Math.max(0, Math.min(snapshot.text.length, snapshot.selectionStart));
  const end = Math.max(start, Math.min(snapshot.text.length, snapshot.selectionEnd));
  const text = snapshot.text.slice(0, start) + replacement + snapshot.text.slice(end);
  const caret = start + replacement.length;
  return { text, selectionStart: caret, selectionEnd: caret };
}

const A1Editing = Object.freeze({
  EditingHistory,
  findNext,
  replaceCurrentOrNext,
  replaceSelection,
});

(globalThis as typeof globalThis & { A1Editing: typeof A1Editing }).A1Editing = A1Editing;
