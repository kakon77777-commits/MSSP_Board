// Strict shapes for the portfolio files, and the two things JSON.parse hides.
//
// `JSON.parse` accepts a duplicate key and silently keeps the last one, and it
// accepts any extra field at all. Both are how a file starts meaning something
// other than what a reader thinks it says, so both are rejected here rather than
// tolerated: an unknown field is usually a typo in a known one, and the typo is
// invisible precisely because nothing complains.
export const ROADMAP_FIELDS = Object.freeze(["schema", "note", "selection_source", "positions"]);
export const ROADMAP_POSITION_FIELDS = Object.freeze(["position", "slug", "selection"]);
export const SELECTIONS = Object.freeze(["recovered", "unnamed_pending_bounded_review"]);
export const ROADMAP_SCHEMA = "mssp.portfolio-roadmap/v0-experimental";
export const PRODUCT_SCHEMA = "mssp.product-record/v0-experimental";
export const INDEX_SCHEMA = "mssp.portfolio-index/v0-experimental";
export const SELECTION_SNAPSHOT_SCHEMA =
  "mssp.portfolio-selection-snapshot/v0-experimental";
export const SELECTION_SNAPSHOT_FIELDS = Object.freeze(
  ["schema", "note", "source", "positions"]);

export const PRODUCT_FIELDS = Object.freeze([
  "schema", "position", "id", "slug", "title_zh", "title_en", "summary_zh", "summary_en",
  "denominator_ref", "app_path", "owners", "note", "work_items", "stages", "blockers",
  "close", "measured", "demonstrates", "intro_page",
]);
export const STAGE_FIELDS = Object.freeze(
  ["stage", "applicability", "state", "rationale", "evidence_refs"]);
export const WORK_ITEM_FIELDS = Object.freeze(["key", "title", "state", "evidence_refs"]);
export const WORK_ITEM_STATES = Object.freeze(
  ["not_started", "active", "blocked", "passed", "deferred", "superseded"]);
export const BLOCKER_FIELDS = Object.freeze(["key", "title", "state", "rationale", "evidence_refs"]);
export const BLOCKER_STATES = Object.freeze(
  ["open", "resolved", "moved_outside_technical_slice"]);
export const COMMIT_EVIDENCE_FIELDS = Object.freeze(["kind", "ref"]);
export const PATH_EVIDENCE_FIELDS = Object.freeze(["kind", "ref", "at_commit"]);
export const EXTERNAL_EVIDENCE_FIELDS = Object.freeze(
  ["kind", "ref", "bytes", "sha256"]);
export const REPOSITORY_SNAPSHOT_EVIDENCE_FIELDS = Object.freeze(
  ["kind", "ref", "bytes", "sha256"]);
export const EVIDENCE_KINDS = Object.freeze(
  ["commit", "path", "external_digest", "repository_snapshot"]);
export const CLOSE_FIELDS = Object.freeze(["commit", "tree", "date"]);
export const OWNER_FIELDS = Object.freeze(["build", "manifest_and_oracle", "system_acceptance"]);
export const MEASURED_FIELDS = Object.freeze([
  "tests", "test_failures", "drills", "drill_mutations_surviving",
  "acceptance_ids", "acceptance_ids_open",
  "outsourced_units_in_tree", "outsourced_units_byte_identical",
]);

export const isPlainObject = (value) => value !== null
  && typeof value === "object" && !Array.isArray(value);
export const isNonEmptyString = (value) => typeof value === "string"
  && value.trim().length > 0;
export const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

/**
 * Find duplicate object keys, which JSON.parse silently collapses.
 *
 * A scanner over the raw text rather than a parse, because by the time you hold
 * the parsed object the evidence is gone: the loser of a duplicate pair leaves
 * no trace at all.
 */
export function duplicateKeys(text) {
  const found = [];
  const stack = [];
  let index = 0;
  let inString = false;
  let escaped = false;
  let currentRaw = "";
  let lastKey = null;

  while (index < text.length) {
    const ch = text[index];
    if (inString) {
      if (escaped) { currentRaw += `\\${ch}`; escaped = false; }
      else if (ch === "\\") { escaped = true; }
      else if (ch === '"') {
        inString = false;
        const frame = stack[stack.length - 1];
        if (frame?.type === "object" && frame.expectingKey) {
          try { lastKey = JSON.parse(`"${currentRaw}"`); }
          catch { lastKey = currentRaw; }
        }
      } else currentRaw += ch;
      index += 1;
      continue;
    }
    if (ch === '"') { inString = true; currentRaw = ""; index += 1; continue; }
    if (ch === "{") {
      stack.push({ type: "object", keys: new Set(), expectingKey: true });
      index += 1;
      continue;
    }
    if (ch === "}") { stack.pop(); index += 1; continue; }
    if (ch === "[") {
      stack.push({ type: "array", keys: null, expectingKey: false });
      index += 1;
      continue;
    }
    if (ch === "]") { stack.pop(); index += 1; continue; }
    if (ch === ",") {
      const frame = stack[stack.length - 1];
      if (frame?.type === "object") frame.expectingKey = true;
      index += 1;
      continue;
    }
    if (ch === ":") {
      const frame = stack[stack.length - 1];
      if (frame?.type === "object" && frame.expectingKey && lastKey !== null) {
        if (frame.keys.has(lastKey)) found.push(lastKey);
        frame.keys.add(lastKey);
        frame.expectingKey = false;
        lastKey = null;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return found;
}

/** Field names present that the shape does not declare. */
export function unknownFields(object, allowed) {
  if (!isPlainObject(object)) return [];
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

/** Field names the shape declares that are absent. */
export function missingFields(object, required) {
  if (!isPlainObject(object)) return [...required];
  return required.filter((key) => !(key in object));
}
