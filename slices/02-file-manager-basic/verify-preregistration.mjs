import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderReadme } from "./render-readme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootIndex = process.argv.indexOf("--root");
const ROOT = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : here;

const TOP_FIELDS = [
  "schema", "charter", "app_id", "wave", "position", "revision", "created_at",
  "primary_user_interface", "target_platform", "evidence_labeling", "product_claim", "root_scope",
  "primary_workflow", "active_denominator", "capability_acceptance_map",
  "capability_acceptance_rule", "acceptance_rows", "system_acceptance_rows",
  "cross_cutting_contracts", "deferred_capabilities", "excluded_scope",
  "fixture_contract", "performance", "timing_policy", "comparator", "topology",
  "membership", "attack_protocol", "stop_boundary",
];
const DENOMINATOR = [
  "choose-root", "directory-view", "navigate-within-root", "refresh-external-change",
  "entry-selection", "create-directory", "rename-entry", "copy-entries",
  "move-entries", "trash-entries",
];
const ROW_FIELDS = [
  "capability", "polarity", "expected_outcomes", "action", "oracle", "failure_signal",
];
const EXPECTED_OUTCOME_FIELDS = ["operation_statuses", "snapshot_states", "view_states"];
const OPERATION_STATUSES = ["accepted", "cancelled", "refused", "failed", "partial"];
const ATTACK_OPERATION_STATUSES = ["cancelled", "refused", "failed", "partial"];
const SNAPSHOT_STATES = ["current", "unchanged", "unavailable"];
const VIEW_STATES = ["complete", "partial"];
const SYSTEM_ROW_FIELDS = ["action", "oracle", "failure_signal", "covered_by", "dynamic_subjects"];
const DYNAMIC_SUBJECT_FIELDS = [
  "id", "paths", "operation", "precondition", "precondition_proof",
  "expected", "cleanup", "coverage_label", "precondition_failure",
];
const SYSTEM_ROWS = [
  "FM-SYS-RESULT-UNION", "FM-SYS-SNAPSHOT-SEQUENCE", "FM-SYS-SNAPSHOT-UNAVAILABLE",
  "FM-SYS-ENTRY-ID-SCOPE", "FM-SYS-PATH-AUTHORITY", "FM-SYS-REPARSE",
  "FM-SYS-NO-OVERWRITE", "FM-SYS-ACTION-SHAPE", "FM-SYS-NO-PERMANENT-DELETE",
  "FM-SYS-RELAUNCH-RESELECT",
];
const REQUIRED_SPECIAL_ROWS = {
  "choose-root": ["FM-ROOT-CANCEL", "FM-ROOT-FAIL"],
  "entry-selection": ["FM-SELECT-SINGLE", "FM-SELECT-MULTI"],
  "copy-entries": ["FM-COPY-FILE", "FM-COPY-DIRECTORY"],
  "move-entries": ["FM-MOVE-FILE", "FM-MOVE-DIRECTORY"],
  "trash-entries": ["FM-TRASH-FILE", "FM-TRASH-DIRECTORY"],
};
const REQUIRED_FIXTURES = [
  "nav", "nav/child.txt", "copy-file.bin", "copy-dir", "copy-dir/nested/a.txt",
  "copy-dir/nested/deeper/b.bin", "copy-dir/empty", "move-file.txt", "move-dir",
  "move-dir/nested.txt", "trash-file.txt", "trash-dir", "trash-dir/nested.txt",
  "partial/ok.bin", "partial/locked.bin", "partial/unreadable.bin",
  "partial/trash-locked.txt", "refresh/base.txt", "rename-me.txt",
  "rename-conflict.txt", "dest-copy", "dest-copy-conflict",
  "dest-copy-conflict/copy-file.bin", "dest-move", "dest-move-conflict",
  "dest-move-conflict/move-file.txt",
];
const DYNAMIC_SUBJECT_IDS = [
  "escape-junction", "locked-member", "unreadable-entry", "refresh-change",
  "trash-failure", "post-operation-snapshot-failure", "unchanged-refresh",
  "root-open-failure", "relaunch-reselect",
];

const sameArray = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length
  && actual.every((value, index) => value === expected[index]);
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};
const exactKeys = (object, expected) => object !== null && typeof object === "object"
  && !Array.isArray(object)
  && sameArray(Object.keys(object).sort(), [...expected].sort());
const normalizedProse = (value) => typeof value === "string"
  ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  : "";
const outcomeMarker = (axis, outcome) => `${axis}=${outcome}`;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Recursive JSON scanner that decodes object-key escapes before comparing. A
// raw-text regex misses `"slug"` + `"\u0073lug"`, even though JSON.parse sees
// those as the same key and silently discards the first value.
function duplicateKeys(text) {
  let index = 0;
  const duplicates = [];
  const whitespace = () => { while (/\s/.test(text[index] ?? "")) index += 1; };
  const parseString = () => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') return JSON.parse(text.slice(start, index));
    }
    throw new Error("unterminated JSON string");
  };
  const parsePrimitive = () => {
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
  };
  const parseValue = () => {
    whitespace();
    const char = text[index];
    if (char === "{") parseObject();
    else if (char === "[") parseArray();
    else if (char === '"') parseString();
    else parsePrimitive();
  };
  const parseArray = () => {
    index += 1;
    whitespace();
    if (text[index] === "]") { index += 1; return; }
    while (index < text.length) {
      parseValue();
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      if (text[index] !== ",") throw new Error("invalid JSON array separator");
      index += 1;
    }
  };
  const parseObject = () => {
    index += 1;
    const seen = new Set();
    whitespace();
    if (text[index] === "}") { index += 1; return; }
    while (index < text.length) {
      whitespace();
      if (text[index] !== '"') throw new Error("invalid JSON object key");
      const key = parseString();
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
      whitespace();
      if (text[index] !== ":") throw new Error("invalid JSON object separator");
      index += 1;
      parseValue();
      whitespace();
      if (text[index] === "}") { index += 1; return; }
      if (text[index] !== ",") throw new Error("invalid JSON object separator");
      index += 1;
    }
  };
  parseValue();
  return duplicates;
}

export function verify(root = ROOT) {
  const problems = [];
  const fail = (label, detail = "") => problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  const check = (label, condition, detail = "") => { if (!condition) fail(label, detail); };
  const preregPath = path.join(root, "preregistration.json");
  if (!fs.existsSync(preregPath)) return { ok: false, problems: ["preregistration.json missing"] };

  const text = fs.readFileSync(preregPath, "utf8");
  let document;
  try {
    for (const key of duplicateKeys(text)) fail("duplicate JSON key", key);
    document = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [...problems, `invalid JSON — ${error.message}`] };
  }

  check("exact top-level schema fields", exactKeys(document, TOP_FIELDS));
  check("schema id", document.schema === "mssp.product-preregistration/v0", String(document.schema));
  check("app identity", document.app_id === "file-manager-basic" && document.position === "02");
  check("revision", document.revision === "v0");
  check("created_at calendar date", validDate(document.created_at));
  check("primary interface", document.primary_user_interface === "GUI");
  check("target platform", document.target_platform?.os === "Windows 11 x64"
    && document.target_platform?.other_os === "NotMeasured");
  check("evidence labeling", document.evidence_labeling?.stubbed_never_counts_as_native === true
    && nonempty(document.evidence_labeling?.native_directory_picker)
    && nonempty(document.evidence_labeling?.native_recycle_operation)
    && nonempty(document.evidence_labeling?.stubbed_automation)
    && document.evidence_labeling?.process_cleanup
      === "only exact process trees launched by the acceptance harness");
  check("product claim", nonempty(document.product_claim));
  check("root scope", document.root_scope?.one_root_at_a_time === true
    && document.root_scope?.root_is_always_visible === true
    && document.root_scope?.change_root_is_explicit === true
    && document.root_scope?.remembered_root_required === false
    && document.root_scope?.selection_policy
      === "any_user_selected_existing_non_reparse_directory"
    && document.root_scope?.navigate_above_root === "refused");
  check("root selection policy", document.root_scope?.selection_policy
    === "any_user_selected_existing_non_reparse_directory");

  const workflow = document.primary_workflow;
  check("primary workflow", Array.isArray(workflow) && workflow.length === 13);
  if (Array.isArray(workflow)) {
    const expected = Array.from({ length: 13 }, (_, i) => `W${String(i + 1).padStart(2, "0")}`);
    check("primary workflow IDs", sameArray(workflow.map((x) => x?.id), expected));
    for (const step of workflow) check(`workflow ${step?.id}`, exactKeys(step, ["id", "action"])
      && nonempty(step.action));
  }

  check("active denominator exact set", sameArray(document.active_denominator, DENOMINATOR),
    JSON.stringify(document.active_denominator));
  const map = document.capability_acceptance_map;
  check("acceptance map exact capabilities", exactKeys(map, DENOMINATOR));
  if (map !== null && typeof map === "object" && !Array.isArray(map)) {
    const mapKeys = Object.keys(map);
    const missingCapabilities = DENOMINATOR.filter((capability) => !mapKeys.includes(capability));
    const orphanCapabilities = mapKeys.filter((capability) => !DENOMINATOR.includes(capability));
    check("acceptance map missing capabilities", missingCapabilities.length === 0,
      missingCapabilities.join(", "));
    check("orphan acceptance mapping", orphanCapabilities.length === 0,
      orphanCapabilities.join(", "));
  }
  const rows = document.acceptance_rows;
  check("acceptance rows object", rows !== null && typeof rows === "object" && !Array.isArray(rows));
  const mapped = [];
  if (map && rows) {
    for (const capability of DENOMINATOR) {
      const ids = map[capability];
      check(`acceptance map ${capability}`, Array.isArray(ids) && ids.length >= 2);
      if (!Array.isArray(ids)) continue;
      const polarities = new Set();
      for (const id of ids) {
        mapped.push(id);
        const row = rows[id];
        check(`${capability} acceptance ID ${id}`, row !== undefined, "row missing");
        if (!row) continue;
        check(`${id} exact row fields`, exactKeys(row, ROW_FIELDS));
        check(`${id} capability`, row.capability === capability, String(row.capability));
        check(`${id} polarity`, ["positive", "attack"].includes(row.polarity));
        polarities.add(row.polarity);
        for (const field of ["action", "oracle", "failure_signal"]) {
          check(`${id} ${field}`, nonempty(row[field]));
        }
        const outcomes = row.expected_outcomes;
        check(`${id} expected results fields`, exactKeys(outcomes, EXPECTED_OUTCOME_FIELDS));
        const statuses = outcomes?.operation_statuses;
        const snapshotStates = outcomes?.snapshot_states;
        const viewStates = outcomes?.view_states;
        const isDirectoryView = capability === "directory-view";
        check(`${id} expected operation statuses`, Array.isArray(statuses)
          && new Set(statuses).size === statuses.length
          && statuses.every((status) => OPERATION_STATUSES.includes(status))
          && (isDirectoryView ? statuses.length === 0 : statuses.length > 0));
        check(`${id} expected snapshot states`, Array.isArray(snapshotStates)
          && snapshotStates.length > 0
          && new Set(snapshotStates).size === snapshotStates.length
          && snapshotStates.every((state) => SNAPSHOT_STATES.includes(state)));
        check(`${id} expected view states`, Array.isArray(viewStates)
          && new Set(viewStates).size === viewStates.length
          && viewStates.every((state) => VIEW_STATES.includes(state))
          && (isDirectoryView ? viewStates.length === 1 : viewStates.length === 0));
        if (row.polarity === "positive") {
          check(`${id} positive expected results`, sameArray(snapshotStates, ["current"])
            && (isDirectoryView
              ? sameArray(statuses, []) && sameArray(viewStates, ["complete"])
              : sameArray(statuses, ["accepted"]) && sameArray(viewStates, [])));
        }
        if (row.polarity === "attack") {
          const hasAdverseOutcome = (Array.isArray(statuses)
              && statuses.some((status) => ATTACK_OPERATION_STATUSES.includes(status)))
            || snapshotStates?.includes("unavailable")
            || viewStates?.includes("partial");
          check(`${id} attack expected results`, hasAdverseOutcome
            && (isDirectoryView
              ? sameArray(statuses, []) && sameArray(viewStates, ["partial"])
              : statuses?.every((status) => ATTACK_OPERATION_STATUSES.includes(status))
                && sameArray(viewStates, [])));
        }
        if (Array.isArray(statuses) && Array.isArray(snapshotStates) && Array.isArray(viewStates)) {
          const markers = [
            ...statuses.map((status) => outcomeMarker("operation_status", status)),
            ...snapshotStates.map((state) => outcomeMarker("snapshot_state", state)),
            ...viewStates.map((state) => outcomeMarker("view_state", state)),
          ];
          const foundMarkers = [...row.oracle.matchAll(/\b([a-z_]+)=([a-z_]+)\b/g)]
            .map((match) => `${match[1]}=${match[2]}`);
          check(`${id} oracle names expected results`, markers
            .every((marker) => row.oracle.includes(marker)));
          check(`${id} oracle markers exactly match expected results`,
            foundMarkers.length === markers.length
            && new Set(foundMarkers).size === foundMarkers.length
            && markers.every((marker) => foundMarkers.includes(marker)));
        }
        check(`${id} oracle and failure signal differ`, normalizedProse(row.oracle) !== ""
          && normalizedProse(row.oracle) !== normalizedProse(row.failure_signal));
      }
      check(`${capability} positive and attack rows`, polarities.has("positive") && polarities.has("attack"));
    }
    const unique = new Set(mapped);
    check("acceptance ID shared across capabilities", unique.size === mapped.length,
      `${mapped.length - unique.size} duplicate mapping(s)`);
    const orphan = Object.keys(rows).filter((id) => !unique.has(id));
    check("orphan acceptance rows", orphan.length === 0, orphan.join(", "));
  }
  for (const [capability, ids] of Object.entries(REQUIRED_SPECIAL_ROWS)) {
    const found = map?.[capability] ?? [];
    check(`${capability} keeps distinct file/directory or single/multi rows`,
      ids.every((id) => found.includes(id)), ids.filter((id) => !found.includes(id)).join(", "));
  }
  check("rename conflict has a real single-segment sentinel",
    rows?.["FM-RENAME-CONFLICT"]?.action?.includes("rename-me.txt")
    && rows?.["FM-RENAME-CONFLICT"]?.action?.includes("rename-conflict.txt")
    && !rows?.["FM-RENAME-CONFLICT"]?.action?.includes("conflicts/"));
  check("copy conflict has different-byte pinned destination",
    rows?.["FM-COPY-CONFLICT"]?.action?.includes("copy-file.bin")
    && rows?.["FM-COPY-CONFLICT"]?.action?.includes("dest-copy-conflict/copy-file.bin"));
  check("move conflict has different-byte pinned destination",
    rows?.["FM-MOVE-CONFLICT"]?.action?.includes("move-file.txt")
    && rows?.["FM-MOVE-CONFLICT"]?.action?.includes("dest-move-conflict/move-file.txt"));
  check("root refusal names only defined invalid subjects",
    rows?.["FM-ROOT-REFUSE"]?.action?.includes("regular file path")
    && rows?.["FM-ROOT-REFUSE"]?.action?.includes("missing directory path")
    && !rows?.["FM-ROOT-REFUSE"]?.action?.includes("disallowed root"));
  check("choose-root runnable failed arm",
    rows?.["FM-ROOT-FAIL"]?.action?.includes("root-open-failure")
    && rows?.["FM-ROOT-FAIL"]?.oracle?.includes("typed failed")
    && rows?.["FM-ROOT-FAIL"]?.oracle?.includes("no snapshot")
    && rows?.["FM-ROOT-FAIL"]?.failure_signal?.includes("normal control fails"));
  check("navigation escape separates malformed payload from real junction ID",
    rows?.["FM-NAV-ESCAPE"]?.action?.includes("malformed IPC")
    && rows?.["FM-NAV-ESCAPE"]?.action?.includes("escape-junction")
    && rows?.["FM-NAV-ESCAPE"]?.oracle?.includes("distinct typed codes"));
  check("capability acceptance rule", nonempty(document.capability_acceptance_rule));

  check("system acceptance exact IDs", exactKeys(document.system_acceptance_rows, SYSTEM_ROWS));
  const systemDynamicRefs = [];
  if (document.system_acceptance_rows) {
    for (const [id, row] of Object.entries(document.system_acceptance_rows)) {
      check(`system acceptance ${id} runnable fields`, exactKeys(row, SYSTEM_ROW_FIELDS));
      if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
      for (const field of ["action", "oracle", "failure_signal"]) {
        check(`system acceptance ${id} ${field}`, nonempty(row[field]));
      }
      check(`system acceptance ${id} oracle and failure signal differ`,
        normalizedProse(row.oracle) !== ""
        && normalizedProse(row.oracle) !== normalizedProse(row.failure_signal));
      check(`system acceptance ${id} covered_by`, Array.isArray(row.covered_by)
        && row.covered_by.every((acceptanceId) => rows?.[acceptanceId] !== undefined));
      check(`system acceptance ${id} dynamic_subjects`, Array.isArray(row.dynamic_subjects)
        && row.dynamic_subjects.every(nonempty));
      if (Array.isArray(row.dynamic_subjects)) systemDynamicRefs.push(...row.dynamic_subjects);
    }
  }

  const contracts = document.cross_cutting_contracts;
  check("cross-cutting contracts", exactKeys(contracts,
    ["entry_identity", "operation_result", "snapshot", "path_authority"]));
  check("entry identity scope", contracts?.entry_identity?.issuer === "main_process"
    && contracts?.entry_identity?.scope === "one_directory_snapshot_generation"
    && contracts?.entry_identity?.opaque_to_renderer === true
    && contracts?.entry_identity?.invalidated_by === "every_new_published_snapshot"
    && contracts?.entry_identity?.multi_selection_semantics
      === "exact_set_membership_order_not_semantic");
  check("renderer path authority", sameArray(contracts?.entry_identity?.renderer_never_submits,
    ["absolute_path", "relative_path", "filesystem_handle"]));
  check("overall statuses", sameArray(contracts?.operation_result?.overall_statuses,
    ["accepted", "partial", "refused", "failed"]));
  check("per-entry statuses", sameArray(contracts?.operation_result?.per_entry_statuses,
    ["accepted", "refused", "failed"]));
  check("root selection statuses", sameArray(
    contracts?.operation_result?.root_selection_statuses,
    ["accepted", "cancelled", "refused", "failed"]));
  check("root selection status meanings", exactKeys(
    contracts?.operation_result?.root_selection_meanings,
    ["accepted", "cancelled", "refused", "failed"])
    && Object.values(contracts.operation_result.root_selection_meanings).every(nonempty));
  check("root selection failed arm meaning",
    contracts?.operation_result?.root_selection_meanings?.failed
      === "the picker or admitted root-open operation fails operationally without replacing the previous root");
  check("per-entry status meanings", exactKeys(contracts?.operation_result?.per_entry_meanings,
    ["accepted", "refused", "failed"])
    && Object.values(contracts.operation_result.per_entry_meanings).every(nonempty));
  check("result aggregation", contracts?.operation_result?.aggregation?.all_accepted === "accepted"
    && contracts?.operation_result?.aggregation?.at_least_one_accepted_and_any_nonaccepted === "partial"
    && contracts?.operation_result?.aggregation?.no_success_no_failed_at_least_one_refused === "refused"
    && contracts?.operation_result?.aggregation?.no_success_with_any_failed === "failed");
  check("operation result completeness", contracts?.operation_result?.every_requested_id_has_outcome === true
    && contracts?.operation_result?.duplicate_unknown_stale_or_cross_generation_ids
      === "refuse_whole_request_before_mutation"
    && contracts?.operation_result?.typed_code_required_for_nonaccepted === true);
  check("generation semantics", contracts?.snapshot?.generation_semantics
    === "published_snapshot_sequence"
    && contracts?.snapshot?.increment === "exactly_one_per_published_snapshot"
    && contracts?.snapshot?.completed_refresh_publication
      === "always_publish_one_snapshot_even_if_entries_are_byte_identical"
    && contracts?.snapshot?.mutation_observation_source === "per_entry_status_only");
  check("snapshot states", sameArray(contracts?.snapshot?.result_states,
    ["current", "unchanged", "unavailable"]));
  check("unavailable snapshot typed code", contracts?.snapshot?.unavailable_requires_typed_code === true
    && Array.isArray(contracts?.snapshot?.unavailable_codes_minimum)
    && contracts.snapshot.unavailable_codes_minimum.length >= 3);
  check("partial view semantics", sameArray(contracts?.snapshot?.partial_view_states,
    ["complete", "partial"]) && contracts?.snapshot?.false_empty_forbidden === true);
  check("path authority owner", contracts?.path_authority?.owner === "main_process"
    && contracts?.path_authority?.default_conflict_policy === "refuse_without_overwrite");
  check("cross-device move is not an acceptance subject",
    contracts?.path_authority?.cross_device_move === "unsupported_not_an_acceptance_subject"
    && !Object.values(rows ?? {}).some((row) => row?.action?.includes("cross-device")));
  check("reparse policy", contracts?.path_authority?.reparse?.visible_in_view === true
    && contracts?.path_authority?.reparse?.selected_root === "refused_if_reparse"
    && contracts?.path_authority?.reparse?.traversal === "refused"
    && contracts?.path_authority?.reparse?.mutation === "refused"
    && contracts?.path_authority?.reparse?.string_containment_security_claim === false);

  const deferred = document.deferred_capabilities;
  const shellOpen = Array.isArray(deferred)
    ? deferred.find((x) => x?.id === "open-with-default-application") : undefined;
  check("default-application capability is deferred", shellOpen?.state === "deferred"
    && shellOpen?.in_active_denominator === false && nonempty(shellOpen?.rationale)
    && Array.isArray(shellOpen?.forbidden_evidence) && shellOpen.forbidden_evidence.length >= 4
    && nonempty(shellOpen?.revisit_gate));
  check("default-application absent from active denominator",
    !document.active_denominator?.includes("open-with-default-application"));
  check("excluded scope", Array.isArray(document.excluded_scope)
    && document.excluded_scope.includes("permanent delete")
    && document.excluded_scope.includes("cross-device move")
    && document.excluded_scope.includes("empty-file creation"));

  const fixture = document.fixture_contract;
  check("fixture contract", fixture?.materialization_owner === "independent_acceptance"
    && fixture?.product_may_not_generate_expected_values === true
    && Array.isArray(fixture?.entries));
  const dynamicPolicy = fixture?.dynamic_subject_policy;
  check("dynamic subject policy", sameArray(dynamicPolicy?.precondition_states,
    ["proven", "not_proven"])
    && dynamicPolicy?.action_requires === "proven"
    && dynamicPolicy?.not_proven_result === "DID_NOT_APPLY_acceptance_failure"
    && dynamicPolicy?.did_not_apply_counts_as_caught === false
    && sameArray(dynamicPolicy?.required_result_fields,
      ["subject_id", "precondition_state", "proof_ref", "action_started", "outcome", "cleanup_state"])
    && dynamicPolicy?.cleanup_requirement
      === "finally_restore_exact_subject_and_prove_postcondition");
  const fixturePaths = new Set();
  if (Array.isArray(fixture?.entries)) {
    for (const entry of fixture.entries) {
      const scope = `fixture ${entry?.path}`;
      check(`${scope} path`, nonempty(entry?.path)
        && !path.isAbsolute(entry.path)
        && !entry.path.includes("\\")
        && !entry.path.split("/").some((part) => ["", ".", ".."].includes(part)));
      check(`${scope} unique`, !fixturePaths.has(entry?.path));
      fixturePaths.add(entry?.path);
      check(`${scope} kind`, ["file", "directory"].includes(entry?.kind));
      if (entry?.kind === "file") {
        check(`${scope} exact fields`, exactKeys(entry,
          ["path", "kind", "bytes", "sha256", "payload_hex"]));
        const payload = typeof entry.payload_hex === "string"
          && /^(?:[0-9a-f]{2})+$/.test(entry.payload_hex)
          ? Buffer.from(entry.payload_hex, "hex") : null;
        check(`${scope} payload hex`, payload !== null);
        if (payload) {
          check(`${scope} byte count`, Number.isInteger(entry.bytes) && entry.bytes === payload.length);
          check(`${scope} sha256`, /^[0-9a-f]{64}$/.test(entry.sha256 ?? "")
            && entry.sha256 === sha256(payload));
        }
      } else if (entry?.kind === "directory") {
        check(`${scope} exact fields`, exactKeys(entry, ["path", "kind"]));
      }
    }
  }
  check("fixture required subjects", REQUIRED_FIXTURES.every((name) => fixturePaths.has(name)),
    REQUIRED_FIXTURES.filter((name) => !fixturePaths.has(name)).join(", "));
  const fixtureByPath = new Map((fixture?.entries ?? []).map((entry) => [entry?.path, entry]));
  const conflictPairs = [
    ["rename-me.txt", "rename-conflict.txt"],
    ["copy-file.bin", "dest-copy-conflict/copy-file.bin"],
    ["move-file.txt", "dest-move-conflict/move-file.txt"],
  ];
  check("conflict fixture sentinels are pinned and different-byte", conflictPairs.every(([source, target]) => {
    const sourceHash = fixtureByPath.get(source)?.sha256;
    const targetHash = fixtureByPath.get(target)?.sha256;
    return /^[0-9a-f]{64}$/.test(sourceHash ?? "")
      && /^[0-9a-f]{64}$/.test(targetHash ?? "")
      && sourceHash !== targetHash;
  }));
  const dynamicSubjects = Array.isArray(fixture?.dynamic_subjects) ? fixture.dynamic_subjects : [];
  const dynamicIds = dynamicSubjects.map((subject) => subject?.id);
  check("fixture dynamic subject IDs", sameArray(dynamicIds, DYNAMIC_SUBJECT_IDS));
  check("fixture dynamic subject IDs unique", new Set(dynamicIds).size === dynamicIds.length);
  for (const subject of dynamicSubjects) {
    const scope = `dynamic subject ${subject?.id}`;
    check(`${scope} exact runnable fields`, exactKeys(subject, DYNAMIC_SUBJECT_FIELDS));
    if (subject === null || typeof subject !== "object" || Array.isArray(subject)) continue;
    check(`${scope} paths`, Array.isArray(subject.paths) && subject.paths.length > 0
      && subject.paths.every((value) => nonempty(value)
        && (value === "." || (!path.isAbsolute(value) && !value.includes("\\")
          && !value.split("/").some((part) => ["", ".", ".."].includes(part))))));
    for (const field of [
      "operation", "precondition", "precondition_proof", "expected", "cleanup", "coverage_label",
    ]) check(`${scope} ${field}`, nonempty(subject[field]));
    check(`${scope} precondition failure`,
      subject.precondition_failure === "DID_NOT_APPLY_acceptance_failure");
  }
  check("system acceptance dynamic subjects resolve",
    systemDynamicRefs.every((id) => dynamicIds.includes(id)),
    systemDynamicRefs.filter((id) => !dynamicIds.includes(id)).join(", "));
  const byDynamicId = new Map(dynamicSubjects.map((subject) => [subject?.id, subject]));
  check("unreadable dynamic subject exact binding",
    sameArray(byDynamicId.get("unreadable-entry")?.paths,
      ["partial/unreadable.bin", "dest-copy/unreadable.bin"])
    && byDynamicId.get("unreadable-entry")?.precondition_proof?.includes("independent read/stat control")
    && byDynamicId.get("unreadable-entry")?.cleanup?.includes("restore the saved ACL"));
  check("locked dynamic subject exact binding",
    sameArray(byDynamicId.get("locked-member")?.paths,
      ["partial/locked.bin", "dest-move/locked.bin"])
    && byDynamicId.get("locked-member")?.precondition_proof?.includes("sharing violation")
    && byDynamicId.get("locked-member")?.cleanup?.includes("recorded helper handle/process"));
  check("refresh dynamic subject exact binding",
    sameArray(byDynamicId.get("refresh-change")?.paths,
      ["refresh/base.txt", "refresh/external-added.bin"])
    && byDynamicId.get("refresh-change")?.operation?.includes("a1b2c3d4")
    && byDynamicId.get("refresh-change")?.expected?.includes(
      "97ed8e55519b020c4d9aceb40e0d3bc7eaa22d080d49592bf21206cb697c8a58"));
  check("trash failure dynamic subject exact binding",
    sameArray(byDynamicId.get("trash-failure")?.paths, ["partial/trash-locked.txt"])
    && byDynamicId.get("trash-failure")?.precondition_proof?.includes("control native recycle attempt")
    && byDynamicId.get("trash-failure")?.cleanup?.includes("recorded helper handle/process"));
  check("snapshot unavailable dynamic subject exact binding",
    sameArray(byDynamicId.get("post-operation-snapshot-failure")?.paths,
      ["partial/ok.bin", "dest-copy/post-scan.bin"])
    && byDynamicId.get("post-operation-snapshot-failure")?.operation?.includes("snapshot_read_failed")
    && byDynamicId.get("post-operation-snapshot-failure")?.expected?.includes("snapshot state is unavailable")
    && byDynamicId.get("post-operation-snapshot-failure")?.cleanup?.includes("disarm the adapter"));
  check("root-open failure dynamic subject exact binding",
    sameArray(byDynamicId.get("root-open-failure")?.paths, ["."])
    && byDynamicId.get("root-open-failure")?.operation?.includes("root_snapshot_read_failed")
    && byDynamicId.get("root-open-failure")?.precondition_proof?.includes("valid ordinary root")
    && byDynamicId.get("root-open-failure")?.expected?.includes("A remains selected")
    && byDynamicId.get("root-open-failure")?.expected?.includes("no B snapshot")
    && byDynamicId.get("root-open-failure")?.cleanup?.includes("accepted normal snapshot")
    && byDynamicId.get("root-open-failure")?.cleanup?.includes("reselect A"));
  check("relaunch dynamic subject exact binding",
    sameArray(byDynamicId.get("relaunch-reselect")?.paths, ["."])
    && byDynamicId.get("relaunch-reselect")?.precondition_proof?.includes("B differs from A")
    && byDynamicId.get("relaunch-reselect")?.expected?.includes("no root is active before explicit selection")
    && byDynamicId.get("relaunch-reselect")?.cleanup?.includes("exact process tree"));

  check("performance is NotMeasured", document.performance === "NotMeasured");
  check("timing policy", document.timing_policy?.purpose?.includes("hang detection")
    && document.timing_policy?.per_gui_action_hard_cap_seconds === 30
    && document.timing_policy?.workflow_hard_cap_seconds === 180);
  const capPolicy = document.timing_policy?.cap_breach_policy;
  const capClassifications = capPolicy?.classifications;
  check("cap breach policy exact fields", exactKeys(capPolicy,
    ["classification_required", "classifications", "required_record_fields",
      "direct_timeout_to_product_failure", "silent_cap_increase",
      "route_or_subject_substitution"]));
  check("cap breach policy", capPolicy?.classification_required === true
    && exactKeys(capClassifications,
      ["product_hang", "instrument_subject_mismatch", "environment_limit"])
    && sameArray(capPolicy?.required_record_fields,
      ["action_id", "classification", "elapsed_ms", "cap_ms", "timer_start_evidence",
        "timer_stop_evidence", "subject_manifest_sha256", "environment_snapshot_ref"])
    && capPolicy?.direct_timeout_to_product_failure === false
    && capPolicy?.silent_cap_increase === "forbidden"
    && capPolicy?.route_or_subject_substitution === "forbidden");
  for (const name of ["product_hang", "instrument_subject_mismatch", "environment_limit"]) {
    check(`cap breach policy ${name} fields`, exactKeys(capClassifications?.[name],
      ["acceptance_row_verdict", "product_verdict", "requires"])
      && nonempty(capClassifications?.[name]?.requires));
  }
  check("cap breach policy product hang consequence",
    capClassifications?.product_hang?.acceptance_row_verdict === "failed"
    && capClassifications?.product_hang?.product_verdict === "failed");
  check("cap breach policy instrument mismatch consequence",
    capClassifications?.instrument_subject_mismatch?.acceptance_row_verdict === "invalid_harness"
    && capClassifications?.instrument_subject_mismatch?.product_verdict === "NotMeasured");
  check("cap breach policy environment consequence",
    capClassifications?.environment_limit?.acceptance_row_verdict === "NotMeasured"
    && capClassifications?.environment_limit?.product_verdict === "NotMeasured");
  const timing = document.timing_policy?.bounded_actions;
  check("timing action set", Array.isArray(timing)
    && sameArray(timing.map((x) => x?.id), ["copy-directory-tree", "move-directory-tree"]));
  if (Array.isArray(timing)) {
    for (const action of timing) {
      check(`timing action ${action.id}`, action.trigger === "one_gui_batch_command"
        && nonempty(action.subject) && nonempty(action.timer_start)
        && nonempty(action.timer_stop) && nonempty(action.forbidden_substitution));
    }
  }
  const comparedCapabilities = [
    "directory-view", "navigate-within-root", "refresh-external-change", "create-directory",
    "rename-entry", "copy-entries", "move-entries", "trash-entries",
  ];
  check("comparator mode", document.comparator?.mode === "executable_operation_core"
    && document.comparator?.pre_registered_before_results === true
    && document.comparator?.causal_claim_allowed === false
    && nonempty(document.comparator?.same_subject));
  check("comparator capabilities", sameArray(document.comparator?.compared_capabilities,
    comparedCapabilities)
    && sameArray(document.comparator?.gui_only_capabilities_not_compared,
      ["choose-root", "entry-selection"])
    && !document.comparator.compared_capabilities.some((capability) =>
      document.comparator.gui_only_capabilities_not_compared.includes(capability)));
  check("comparator counted artifacts", sameArray(document.comparator?.counted_artifacts,
    ["comparators/file-manager-basic/operation-core.ts",
      "comparators/file-manager-basic/operation-core.test.mjs"]));
  check("topology not preregistered", document.topology?.preregistered === false
    && nonempty(document.topology?.forbidden_default));
  check("role rotation", document.membership?.preregistration_author === "Metron"
    && document.membership?.first_independent_attacker === "Elenchos"
    && document.membership?.denominator_and_acceptance_attacker === "Pragma"
    && document.membership?.implementation_builder === "unassigned");
  check("attack protocol", Array.isArray(document.attack_protocol?.general)
    && document.attack_protocol.general.length >= 5
    && Array.isArray(document.attack_protocol?.slice_specific)
    && document.attack_protocol.slice_specific.length >= 8);
  check("stop boundary", nonempty(document.stop_boundary)
    && document.stop_boundary.includes("No App-2 product record or production code")
    && document.stop_boundary.includes("No provider call"));

  const readmePath = path.join(root, "README.md");
  // Rendering assumes the structural contract is valid. Once an earlier check
  // is red, calling it would replace the named verifier failure with a generic
  // TypeError (for example, a removed capability map row). Preserve the first
  // actionable diagnostics and test README freshness only on a valid subject.
  if (problems.length === 0) {
    const wanted = renderReadme(document);
    const found = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : null;
    check("README current", found === wanted, found === null ? "README.md missing" : "README.md stale");
  }

  return { ok: problems.length === 0, problems, document, sha256: sha256(Buffer.from(text)) };
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("verify-preregistration.mjs")) {
  const result = verify(ROOT);
  process.stdout.write(`\n=== verify-preregistration — file-manager-basic ${result.document?.revision ?? "?"} ===\n`);
  if (result.sha256) process.stdout.write(`  sha256 ${result.sha256}\n`);
  if (result.ok) {
    process.stdout.write("  all invariants hold\n");
    process.exit(0);
  }
  for (const problem of result.problems) process.stderr.write(`  FAIL ${problem}\n`);
  process.stderr.write(`  ${result.problems.length} PROBLEM(S) — fail closed\n`);
  process.exit(1);
}
