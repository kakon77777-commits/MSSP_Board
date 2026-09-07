import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(here, relative), "utf8"));

test("App2 technical close keeps author, acceptance, drill, ownership and limitation facts distinct", () => {
  const recordPath = path.join(here, "products", "02-file-manager-basic.json");
  assert.ok(fs.existsSync(recordPath), "RED: App2 portfolio record is missing");

  const record = readJson("products/02-file-manager-basic.json");
  const execution = readJson("evidence/2026-09-08-file-manager-execution.json");
  const decision = readJson("evidence/2026-09-08-file-manager-technical-close.json");

  assert.equal(record.close.commit, "40b781c6f903cd941c49af57614c9a02b525907f");
  assert.equal(record.close.tree, "f2317ebb25ff93c4d830e3e5155bf2dc9811bb50");
  assert.deepEqual(record.measured, {
    tests: 54,
    test_failures: 0,
    drills: 11,
    drill_mutations_surviving: 0,
    acceptance_ids: 40,
    acceptance_ids_open: 0,
    outsourced_units_in_tree: 0,
    outsourced_units_byte_identical: false,
  });
  assert.deepEqual(record.owners, [
    { role: "product_build", speaker: "Metron" },
    { role: "fixture_oracle_and_system_acceptance", speaker: "Pragma" },
    { role: "independent_attack_and_close_review", speaker: "Elenchos" },
  ]);

  assert.equal(execution.commands.filter((command) => command.kind === "test").length, 1);
  assert.equal(execution.commands.filter((command) => command.kind === "drill").length, 11);
  assert.equal(execution.acceptance.ids, 40);
  assert.equal(execution.acceptance.open, 0);
  assert.deepEqual(execution.outsourced_units, []);

  assert.equal(decision.decision, "technical_close_accepted");
  assert.equal(decision.commit, record.close.commit);
  assert.equal(decision.tree, record.close.tree);

  const note = `${record.note}\n${record.demonstrates.join("\n")}`;
  assert.match(note, /native directory picker[^\n]*NotMeasured/i);
  assert.match(note, /ready timeout[^\n]*callback[^\n]*2\/2/i);
  assert.match(note, /no release[^\n]*deployment[^\n]*publication[^\n]*App 3/i);
});
