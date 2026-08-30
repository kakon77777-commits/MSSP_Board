// RED-first attacks for the fail-open cases found after the first committed
// portfolio drill. Every case must become a named verifier rejection; a crash,
// timeout, moved target or generic nonzero exit does not count as caught.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const recordPath = path.join(here, "products", "01-text-editor-basic.json");
const roadmapPath = path.join(here, "roadmap.json");
const selectionSnapshotPath = path.join(here, "evidence", "2026-08-30-product-selection.json");
const shadowPath = path.join(here, "products", "00-shadow.json");
const renderer = path.join(here, "render-index.mjs");
const verifier = path.join(here, "verify-portfolio.mjs");
const say = (line) => process.stdout.write(`${line}\n`);

function runNode(file) {
  return spawnSync(process.execPath, [file], {
    cwd: repo,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function verify() {
  const run = runNode(verifier);
  const output = `${run.stderr ?? ""}\n${run.stdout ?? ""}`.trim();
  if (run.status === 0) return { state: "green", first: output.split(/\r?\n/)[0] ?? "" };
  if (run.status === 1 && /^\s*FAIL\s/m.test(output)) {
    return { state: "red", first: output.match(/^\s*FAIL\s.*$/m)?.[0] ?? "FAIL" };
  }
  return {
    state: "error",
    first: run.error?.message ?? output.split(/\r?\n/)[0] ?? `status ${run.status}`,
  };
}

function render() {
  const run = runNode(renderer);
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || "render failed");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const cases = [
  {
    name: "escaped duplicate JSON key",
    file: recordPath,
    applyText(text) {
      const anchor = '  "slug": "text-editor-basic",';
      if (!text.includes(anchor)) return null;
      return text.replace(anchor,
        `${anchor}\n  "\\u0073lug": "text-editor-basic",`);
    },
  },
  {
    name: "not_applicable stage has no review evidence",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      const stage = record.stages.find((item) => item.stage === "island_verification");
      if (!stage) return false;
      stage.applicability = "not_applicable";
      stage.state = "not_started";
      stage.rationale = "reviewed elsewhere";
      stage.evidence_refs = [];
      return true;
    },
  },
  {
    name: "invalid close date",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.close.date = "not-a-date";
      return true;
    },
  },
  {
    name: "calendar-shaped impossible close date",
    file: recordPath,
    applyJson(record) {
      record.close.date = "2026-99-99";
      return true;
    },
  },
  {
    name: "close date is in the future of its decision",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.close.date = "2099-01-01";
      return true;
    },
  },
  {
    name: "close date predates the product decision",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.close.date = "1970-01-02";
      return true;
    },
  },
  {
    name: "roadmap positions is an object",
    file: roadmapPath,
    applyJson(roadmap) {
      roadmap.positions = {};
      return true;
    },
  },
  {
    name: "closed record contains null blocker",
    file: recordPath,
    applyJson(record) {
      record.blockers.push(null);
      return true;
    },
  },
  {
    name: "closed record contains null work item",
    file: recordPath,
    applyJson(record) {
      record.work_items.push(null);
      return true;
    },
  },
  {
    name: "closed record contains null stage",
    file: recordPath,
    applyJson(record) {
      record.stages.push(null);
      return true;
    },
  },
  {
    name: "technical close retains code commit but loses decision evidence",
    file: recordPath,
    applyJson(record) {
      const stage = record.stages.find((item) => item.stage === "technical_close");
      if (!stage) return false;
      stage.evidence_refs = stage.evidence_refs.filter((ref) => ref.kind === "commit");
      return true;
    },
  },
  {
    name: "arbitrary external digest masquerades as close decision",
    file: recordPath,
    applyJson(record) {
      const stage = record.stages.find((item) => item.stage === "technical_close");
      if (!stage) return false;
      stage.evidence_refs = [
        { kind: "commit", ref: record.close.commit },
        { kind: "external_digest", ref: "not-a-close-decision", bytes: 1,
          sha256: "0".repeat(64) },
      ];
      return true;
    },
  },
  {
    name: "unrelated repository snapshot masquerades as close decision",
    file: recordPath,
    applyJson(record) {
      const stage = record.stages.find((item) => item.stage === "technical_close");
      if (!stage) return false;
      const unrelated = readFileSync(path.join(repo, "README.md"));
      stage.evidence_refs = [
        { kind: "commit", ref: record.close.commit },
        { kind: "repository_snapshot", ref: "README.md", bytes: unrelated.byteLength,
          sha256: createHash("sha256").update(unrelated).digest("hex") },
      ];
      return true;
    },
  },
  {
    name: "unverifiable roadmap selection source",
    file: roadmapPath,
    applyJson(roadmap) {
      roadmap.selection_source = "nobody-checked-this";
      return true;
    },
  },
  {
    name: "roadmap selection digest is malformed",
    file: roadmapPath,
    applyJson(roadmap) {
      roadmap.selection_source.sha256 = "0";
      return true;
    },
  },
  {
    name: "repository selection snapshot bytes drift",
    file: selectionSnapshotPath,
    applyJson(snapshot) {
      snapshot.note += " mutated";
      return true;
    },
  },
  {
    name: "roadmap identities disagree with selection snapshot",
    file: roadmapPath,
    applyJson(roadmap) {
      const entry = roadmap.positions.find((item) => item.position === "15");
      if (!entry) return false;
      entry.slug = "password-vault";
      return true;
    },
  },
  {
    name: "moved blocker has no authority evidence",
    file: recordPath,
    applyJson(record) {
      record.blockers.push({
        key: "scope-move", title: "moved without authority",
        state: "moved_outside_technical_slice",
        rationale: "outside this slice", evidence_refs: [],
      });
      return true;
    },
  },
  {
    name: "repo path evidence escapes repository",
    file: recordPath,
    applyJson(record) {
      const item = record.work_items.find((entry) => entry.key === "a2-encoding-boundary");
      if (!item) return false;
      item.evidence_refs[0] = {
        kind: "path", ref: "../MSSP_Architect_Exchange/CURRENT.md",
        at_commit: "7366c4ec0e4404bbb571964adcdc139254df6c50",
      };
      return true;
    },
  },
  {
    name: "unknown product schema version",
    file: recordPath,
    applyJson(record) {
      record.schema = "wrong/schema";
      return true;
    },
  },
  {
    name: "unknown roadmap schema version",
    file: roadmapPath,
    applyJson(roadmap) {
      roadmap.schema = "wrong/roadmap-schema";
      return true;
    },
  },
  {
    name: "measured test count is a string",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.measured.tests = "69";
      return true;
    },
  },
  {
    name: "measured drill count is an invented integer",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.measured.drills = 9999;
      return true;
    },
  },
  {
    name: "measured test count is a different valid integer",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.measured.tests = 1;
      return true;
    },
  },
  {
    name: "zero outsourced units retain byte-identical claim",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.measured.outsourced_units_in_tree = 0;
      record.measured.outsourced_units_byte_identical = true;
      return true;
    },
  },
  {
    name: "system acceptance owner equals build owner",
    file: recordPath,
    regenerate: true,
    applyJson(record) {
      record.owners.system_acceptance = record.owners.build;
      return true;
    },
  },
  {
    name: "duplicate blocker keys",
    file: recordPath,
    applyJson(record) {
      record.blockers.push(
        { key: "same", title: "one", state: "resolved", rationale: null,
          evidence_refs: [{ kind: "commit", ref: "7366c4ec0e4404bbb571964adcdc139254df6c50" }] },
        { key: "same", title: "two", state: "resolved", rationale: null,
          evidence_refs: [{ kind: "commit", ref: "7366c4ec0e4404bbb571964adcdc139254df6c50" }] },
      );
      return true;
    },
  },
];

say("\n=== portfolio follow-up gaps — RED-first ===\n");
const control = verify();
say(`  control ... ${control.state}`);
if (control.state !== "green") process.exit(1);

let green = 0;
let errors = 0;
let didNotApply = 0;
for (const attack of cases) {
  const original = readFileSync(attack.file, "utf8");
  let applied = false;
  try {
    if (attack.applyText) {
      const changed = attack.applyText(original);
      if (changed !== null) {
        writeFileSync(attack.file, changed, "utf8");
        applied = true;
      }
    } else {
      const parsed = JSON.parse(original);
      if (attack.applyJson(parsed)) {
        writeJson(attack.file, parsed);
        applied = true;
      }
    }
    if (!applied) {
      say(`  DID_NOT_APPLY  ${attack.name}`);
      didNotApply += 1;
      continue;
    }
    if (attack.regenerate) render();
    const outcome = verify();
    say(`  ${outcome.state.toUpperCase().padEnd(5)} ${attack.name}  ${outcome.first}`);
    if (outcome.state === "green") green += 1;
    if (outcome.state === "error") errors += 1;
  } finally {
    writeFileSync(attack.file, original, "utf8");
    if (attack.regenerate && applied) render();
  }
}

// A second lexically earlier file with the same position must be inspected, not
// silently overwritten by the later real record in a Map.
try {
  if (existsSync(shadowPath)) throw new Error(`refusing to overwrite ${shadowPath}`);
  writeFileSync(shadowPath, '{"position":"01"}\n', "utf8");
  const outcome = verify();
  say(`  ${outcome.state.toUpperCase().padEnd(5)} shadow product file  ${outcome.first}`);
  if (outcome.state === "green") green += 1;
  if (outcome.state === "error") errors += 1;
} finally {
  rmSync(shadowPath, { force: true });
}

const restored = verify();
say(`\n  restored control ... ${restored.state}`);
say(`  ${cases.length + 1} attacks   ${green} green   ${errors} errors   ${didNotApply} did not apply`);
process.exit(green === 0 && errors === 0 && didNotApply === 0
  && restored.state === "green" ? 0 : 1);
