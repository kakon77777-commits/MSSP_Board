// Prove the App-2 preregistration verifier can fail.
//
// This file is intentionally written before the preregistration and verifier.
// The first TDD run must fail because the clean control is not yet accepted.
// Once the implementation exists, every mutation below must be red, the
// control must stay green, and the canonical slice must remain byte-identical.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.join(here, "verify-preregistration.mjs");
const say = (line = "") => process.stdout.write(`${line}\n`);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function canonicalHashes() {
  const hashes = new Map();
  if (!fs.existsSync(here)) return hashes;
  for (const name of fs.readdirSync(here).sort()) {
    const full = path.join(here, name);
    if (fs.statSync(full).isFile()) hashes.set(name, sha256(fs.readFileSync(full)));
  }
  return hashes;
}

function runVerify(root) {
  const run = spawnSync(process.execPath, [verifier, "--root", root], {
    cwd: path.join(here, "..", ".."),
    encoding: "utf8",
  });
  return {
    ok: run.status === 0,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

function mutateJson(fn) {
  return (root) => {
    const file = path.join(root, "preregistration.json");
    if (!fs.existsSync(file)) return false;
    const document = JSON.parse(fs.readFileSync(file, "utf8"));
    const applied = fn(document);
    if (!applied) return false;
    fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return true;
  };
}

function mutateText(from, to) {
  return (root) => {
    const file = path.join(root, "preregistration.json");
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(from)) return false;
    fs.writeFileSync(file, text.replace(from, to), "utf8");
    return true;
  };
}

const drills = [
  {
    label: "remove choose-root acceptance mapping",
    expect: "acceptance map",
    apply: mutateJson((d) => delete d.capability_acceptance_map?.["choose-root"]),
  },
  {
    label: "add an orphan acceptance mapping",
    expect: "orphan",
    apply: mutateJson((d) => {
      if (!d.capability_acceptance_map || d.capability_acceptance_map.orphan) return false;
      d.capability_acceptance_map.orphan = ["FM-ROOT-SELECT"];
      return true;
    }),
  },
  {
    label: "reuse one acceptance ID across capabilities",
    expect: "acceptance ID",
    apply: mutateJson((d) => {
      const source = d.capability_acceptance_map?.["choose-root"];
      const target = d.capability_acceptance_map?.["directory-view"];
      if (!Array.isArray(source) || !Array.isArray(target) || source.length === 0) return false;
      target.push(source[0]);
      return true;
    }),
  },
  {
    label: "reduce snapshot-unavailable system row to one character",
    expect: "system acceptance",
    apply: mutateJson((d) => {
      if (d.system_acceptance_rows?.["FM-SYS-SNAPSHOT-UNAVAILABLE"] === undefined
          || d.system_acceptance_rows["FM-SYS-SNAPSHOT-UNAVAILABLE"] === "x") return false;
      d.system_acceptance_rows["FM-SYS-SNAPSHOT-UNAVAILABLE"] = "x";
      return true;
    }),
  },
  {
    label: "add an escaped duplicate JSON key",
    expect: "duplicate JSON key",
    apply: mutateText(
      '  "app_id": "file-manager-basic",',
      '  "app_id": "file-manager-basic",\n  "\\u0061pp_id": "file-manager-basic",',
    ),
  },
  {
    label: "use an impossible calendar date",
    expect: "created_at",
    apply: mutateJson((d) => {
      if (d.created_at !== "2026-08-30") return false;
      d.created_at = "2026-02-30";
      return true;
    }),
  },
  {
    label: "collapse execution failure into refusal",
    expect: "overall statuses",
    apply: mutateJson((d) => {
      const statuses = d.cross_cutting_contracts?.operation_result?.overall_statuses;
      if (!Array.isArray(statuses) || !statuses.includes("failed")) return false;
      d.cross_cutting_contracts.operation_result.overall_statuses = statuses.filter((x) => x !== "failed");
      return true;
    }),
  },
  {
    label: "remove snapshot unavailable state",
    expect: "snapshot states",
    apply: mutateJson((d) => {
      const states = d.cross_cutting_contracts?.snapshot?.result_states;
      if (!Array.isArray(states) || !states.includes("unavailable")) return false;
      d.cross_cutting_contracts.snapshot.result_states = states.filter((x) => x !== "unavailable");
      return true;
    }),
  },
  {
    label: "turn generation into a mutation counter",
    expect: "generation semantics",
    apply: mutateJson((d) => {
      const snapshot = d.cross_cutting_contracts?.snapshot;
      if (!snapshot || snapshot.generation_semantics !== "published_snapshot_sequence") return false;
      snapshot.generation_semantics = "mutation_counter";
      return true;
    }),
  },
  {
    label: "allow reparse traversal",
    expect: "reparse policy",
    apply: mutateJson((d) => {
      const reparse = d.cross_cutting_contracts?.path_authority?.reparse;
      if (!reparse || reparse.traversal !== "refused") return false;
      reparse.traversal = "allowed_if_realpath_is_inside";
      return true;
    }),
  },
  {
    label: "leave dynamic attack subjects as IDs only",
    expect: "dynamic subject",
    apply: mutateJson((d) => {
      const subjects = d.fixture_contract?.dynamic_subjects;
      if (!Array.isArray(subjects) || subjects.length === 0) return false;
      d.fixture_contract.dynamic_subjects = subjects.map(({ id }) => ({ id }));
      return true;
    }),
  },
  {
    label: "move deferred default-open into the denominator",
    expect: "active denominator",
    apply: mutateJson((d) => {
      if (!Array.isArray(d.active_denominator)
          || d.active_denominator.includes("open-with-default-application")) return false;
      d.active_denominator.push("open-with-default-application");
      return true;
    }),
  },
  {
    label: "replace the GUI copy action with a test-side loop",
    expect: "timing action",
    apply: mutateJson((d) => {
      const action = d.timing_policy?.bounded_actions?.find((x) => x.id === "copy-directory-tree");
      if (!action || action.trigger !== "one_gui_batch_command") return false;
      action.trigger = "test_side_per_entry_loop";
      return true;
    }),
  },
  {
    label: "remove the directory positive row from copy",
    expect: "copy-entries",
    apply: mutateJson((d) => {
      const ids = d.capability_acceptance_map?.["copy-entries"];
      const index = Array.isArray(ids) ? ids.indexOf("FM-COPY-DIRECTORY") : -1;
      if (index < 0) return false;
      ids.splice(index, 1);
      return true;
    }),
  },
  {
    label: "remove the file positive row from move",
    expect: "move-entries",
    apply: mutateJson((d) => {
      const ids = d.capability_acceptance_map?.["move-entries"];
      const index = Array.isArray(ids) ? ids.indexOf("FM-MOVE-FILE") : -1;
      if (index < 0) return false;
      ids.splice(index, 1);
      return true;
    }),
  },
  {
    label: "replace rename conflict with invalid-name refusal",
    expect: "rename conflict",
    apply: mutateJson((d) => {
      const row = d.acceptance_rows?.["FM-RENAME-CONFLICT"];
      if (!row) return false;
      row.action = "rename to bad/name";
      row.oracle = "request is refused as an invalid single-segment name";
      row.failure_signal = "invalid name is accepted";
      return true;
    }),
  },
  {
    label: "make unavailable snapshot untyped",
    expect: "unavailable snapshot",
    apply: mutateJson((d) => {
      const snapshot = d.cross_cutting_contracts?.snapshot;
      if (!snapshot || snapshot.unavailable_requires_typed_code !== true) return false;
      snapshot.unavailable_requires_typed_code = false;
      return true;
    }),
  },
  {
    label: "collapse an all-failed batch into refusal",
    expect: "result aggregation",
    apply: mutateJson((d) => {
      const aggregation = d.cross_cutting_contracts?.operation_result?.aggregation;
      if (!aggregation || aggregation.no_success_with_any_failed !== "failed") return false;
      aggregation.no_success_with_any_failed = "refused";
      return true;
    }),
  },
  {
    label: "stop publishing snapshots on unchanged refresh",
    expect: "generation semantics",
    apply: mutateJson((d) => {
      const snapshot = d.cross_cutting_contracts?.snapshot;
      if (!snapshot || snapshot.completed_refresh_publication
          !== "always_publish_one_snapshot_even_if_entries_are_byte_identical") return false;
      snapshot.completed_refresh_publication = "publish_only_when_entries_change";
      return true;
    }),
  },
  {
    label: "turn cross-device move into an acceptance subject",
    expect: "cross-device",
    apply: mutateJson((d) => {
      const authority = d.cross_cutting_contracts?.path_authority;
      if (!authority || authority.cross_device_move
          !== "unsupported_not_an_acceptance_subject") return false;
      authority.cross_device_move = "negative_acceptance_subject";
      return true;
    }),
  },
  {
    label: "replace ordinary root policy with an acceptance-only allowlist",
    expect: "root selection policy",
    apply: mutateJson((d) => {
      if (d.root_scope?.selection_policy
          !== "any_user_selected_existing_non_reparse_directory") return false;
      d.root_scope.selection_policy = "pinned_acceptance_root_only";
      return true;
    }),
  },
  {
    label: "make multi-selection order a product claim",
    expect: "entry identity",
    apply: mutateJson((d) => {
      const identity = d.cross_cutting_contracts?.entry_identity;
      if (!identity || identity.multi_selection_semantics
          !== "exact_set_membership_order_not_semantic") return false;
      identity.multi_selection_semantics = "ordered_selection_sequence";
      return true;
    }),
  },
  {
    label: "report stubbed coverage as native",
    expect: "evidence labeling",
    apply: mutateJson((d) => {
      const labeling = d.evidence_labeling;
      if (!labeling || labeling.stubbed_never_counts_as_native !== true) return false;
      labeling.stubbed_never_counts_as_native = false;
      return true;
    }),
  },
  {
    label: "weaken executable comparator to prose after registration",
    expect: "comparator mode",
    apply: mutateJson((d) => {
      if (d.comparator?.mode !== "executable_operation_core") return false;
      d.comparator.mode = "design_only";
      return true;
    }),
  },
  {
    label: "launder GUI-only choose-root into the comparator",
    expect: "comparator capabilities",
    apply: mutateJson((d) => {
      const capabilities = d.comparator?.compared_capabilities;
      if (!Array.isArray(capabilities) || capabilities.includes("choose-root")) return false;
      capabilities.push("choose-root");
      return true;
    }),
  },
  {
    label: "change one pinned fixture payload hash",
    expect: "fixture",
    apply: mutateJson((d) => {
      const entry = d.fixture_contract?.entries?.find((x) => x.kind === "file");
      if (!entry || typeof entry.sha256 !== "string") return false;
      entry.sha256 = "0".repeat(64);
      return true;
    }),
  },
  {
    label: "remove pinned copy and move conflict sentinels",
    expect: "conflict fixture",
    apply: mutateJson((d) => {
      const required = [
        "rename-conflict.txt",
        "dest-copy-conflict/copy-file.bin",
        "dest-move-conflict/move-file.txt",
      ];
      const entries = d.fixture_contract?.entries;
      if (!Array.isArray(entries) || !required.every((name) => entries.some((x) => x.path === name))) {
        return false;
      }
      d.fixture_contract.entries = entries.filter((entry) => !required.includes(entry.path));
      return true;
    }),
  },
  {
    label: "append one dangling hex nibble to a fixture",
    expect: "fixture",
    apply: mutateJson((d) => {
      const entry = d.fixture_contract?.entries?.find((x) => x.kind === "file");
      if (!entry || typeof entry.payload_hex !== "string") return false;
      entry.payload_hex += "f";
      return true;
    }),
  },
  {
    label: "make generated README stale",
    expect: "README",
    apply: (root) => {
      const file = path.join(root, "README.md");
      if (!fs.existsSync(file)) return false;
      fs.appendFileSync(file, "\nstale drill edit\n", "utf8");
      return true;
    },
  },
];

say("\n=== App-2 preregistration verifier drill ===\n");
const before = canonicalHashes();
const control = runVerify(here);
say(`  control (canonical, unmodified) ... ${control.ok ? "green" : "RED"}`);
if (!control.ok) {
  say("  expected TDD RED until preregistration and verifier exist");
  say(`  ${(control.output.trim().split(/\r?\n/)[0] ?? "no diagnostic").slice(0, 180)}`);
  process.exit(1);
}

let green = 0;
let didNotApply = 0;
for (const drill of drills) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "app2-prereg-drill-"));
  try {
    fs.cpSync(here, tempRoot, { recursive: true });
    const applied = drill.apply(tempRoot);
    if (!applied) {
      say(`  DID_NOT_APPLY  ${drill.label}`);
      didNotApply += 1;
      continue;
    }
    const result = runVerify(tempRoot);
    if (result.ok) {
      say(`  GREEN          ${drill.label}`);
      green += 1;
    } else {
      const named = result.output.toLowerCase().includes(drill.expect.toLowerCase());
      say(`  ${named ? "red" : "ERROR"}            ${drill.label}`);
      if (!named) {
        const firstFailure = result.output.split(/\r?\n/)
          .find((line) => line.includes("FAIL"))?.trim() ?? "no named FAIL diagnostic";
        say(`                 ${firstFailure.slice(0, 180)}`);
        green += 1;
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const after = canonicalHashes();
const untouched = before.size === after.size
  && [...before].every(([name, hash]) => after.get(name) === hash);
const restored = runVerify(here);
say(`\n  restored control ... ${restored.ok ? "green" : "RED"}`);
say(`  canonical slice untouched ... ${untouched}`);
say(`  ${drills.length} attacks / ${green} green-or-error / ${didNotApply} did not apply`);

process.exit(green === 0 && didNotApply === 0 && untouched && restored.ok ? 0 : 1);
