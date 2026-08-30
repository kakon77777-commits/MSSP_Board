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
export const EVIDENCE_FIELDS = Object.freeze(["kind", "ref"]);
export const EVIDENCE_KINDS = Object.freeze(["commit", "path"]);
export const CLOSE_FIELDS = Object.freeze(["commit", "tree", "date"]);
export const OWNER_FIELDS = Object.freeze(["build", "manifest_and_oracle", "system_acceptance"]);
export const MEASURED_FIELDS = Object.freeze([
  "tests", "test_failures", "drills", "drill_mutations_surviving",
  "acceptance_ids", "acceptance_ids_open",
  "outsourced_units_in_tree", "outsourced_units_byte_identical",
]);

/**
 * Find duplicate object keys, which JSON.parse silently collapses.
 *
 * A scanner over the raw text rather than a parse, because by the time you hold
 * the parsed object the evidence is gone: the loser of a duplicate pair leaves
 * no trace at all.
 */
export function duplicateKeys(text) {
  const found = [];
  const stack = [new Set()];
  let index = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  let lastKey = null;
  let expectingKey = false;

  while (index < text.length) {
    const ch = text[index];
    if (inString) {
      if (escaped) { current += ch; escaped = false; }
      else if (ch === "\\") { escaped = true; }
      else if (ch === '"') { inString = false; lastKey = current; }
      else current += ch;
      index += 1;
      continue;
    }
    if (ch === '"') { inString = true; current = ""; index += 1; continue; }
    if (ch === "{") { stack.push(new Set()); expectingKey = true; index += 1; continue; }
    if (ch === "}") { stack.pop(); expectingKey = false; index += 1; continue; }
    if (ch === "[") { stack.push(new Set()); expectingKey = false; index += 1; continue; }
    if (ch === "]") { stack.pop(); index += 1; continue; }
    if (ch === ",") { expectingKey = true; index += 1; continue; }
    if (ch === ":") {
      if (expectingKey && lastKey !== null) {
        const scope = stack[stack.length - 1];
        if (scope.has(lastKey)) found.push(lastKey);
        scope.add(lastKey);
      }
      expectingKey = false;
      index += 1;
      continue;
    }
    index += 1;
  }
  return found;
}

/** Field names present that the shape does not declare. */
export function unknownFields(object, allowed) {
  if (object === null || typeof object !== "object" || Array.isArray(object)) return [];
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

/** Field names the shape declares that are absent. */
export function missingFields(object, required) {
  if (object === null || typeof object !== "object") return [...required];
  return required.filter((key) => !(key in object));
}
