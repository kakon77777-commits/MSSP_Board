// 改良點 14 — a partial batch and a complete one are the same value once the
// records are in one array, so the outcome must travel WITH them. And a fact a
// unit could get wrong is not the unit's to state.
//
// Full entry: https://thisoneisneok.com/html/mssp/016-partial-and-complete.html
//
//   node probes/p14-outcome-travels.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const SOURCES = {
  "full-batch": function* () { yield { from: "full-batch", id: "f-1" }; yield { from: "full-batch", id: "f-2" }; yield { from: "full-batch", id: "f-3" }; },
  // The control: two records AND it finishes. breaks-midway also yields two.
  "short-batch": function* () { yield { from: "short-batch", id: "s-1" }; yield { from: "short-batch", id: "s-2" }; },
  "breaks-midway": function* () {
    yield { from: "breaks-midway", id: "b-1" };
    yield { from: "breaks-midway", id: "b-2" };
    throw new Error("connection-reset");
  },
};

// `finished` is OBSERVED here. The source never reports it, so it cannot get
// it wrong. That is the portable half of 改良點 14.
function run1(name, absent = false) {
  if (absent) return { source: name, outcome: "absent", records: [], finished: null };
  const records = [];
  let error = null;
  try { for (const r of SOURCES[name]()) records.push(r); } catch (e) { error = e.message; }
  const finished = error === null;
  const outcome = !finished && records.length ? "partial"
    : !finished ? "failed" : records.length ? "worked" : "empty";
  return { source: name, outcome, records, finished, error };
}

const runAll = (absent = []) => Object.keys(SOURCES).sort().map((n) => run1(n, absent.includes(n)));
const allOrNothing = (rows) => rows.some((r) => r.outcome === "partial" || r.outcome === "failed")
  ? { kept: [], discarded: rows.reduce((n, r) => n + r.records.length, 0) }
  : { kept: rows.flatMap((r) => r.records), discarded: 0 };
const settleEach = (rows) => ({ kept: rows.flatMap((r) => r.records), discarded: 0 });
const fromUnfinished = (rows, kept) => {
  const bad = new Set(rows.filter((r) => r.outcome === "partial").map((r) => r.source));
  return kept.filter((r) => bad.has(r.from)).length;
};

export function run() {
  const { say, check, done } = harness("p14 — the outcome travels with the records");

  const rows = runAll();
  const short = rows.find((r) => r.source === "short-batch");
  const broke = rows.find((r) => r.source === "breaks-midway");

  say("\n  1. the control — same number, opposite reason");
  check("short-batch yielded two and finished", short.records.length === 2 && short.finished === true);
  check("breaks-midway yielded two and did not", broke.records.length === 2 && broke.finished === false);
  check("a count cannot separate them; the outcome can",
    short.records.length === broke.records.length && short.outcome !== broke.outcome);

  say("\n  2. `finished` is observed, never declared");
  check("no source exposes a `finished` field at all",
    Object.values(SOURCES).every((g) => g.finished === undefined),
    "a fact a unit could get wrong is not the unit's to state");

  say("\n  3. removing the broken source gives MORE than keeping it");
  const removed = allOrNothing(runAll(["breaks-midway"]));
  const kept = allOrNothing(rows);
  const settled = settleEach(rows);
  say(`     removed (island test)   all-or-nothing  ${removed.kept.length}`);
  say(`     present and failing     all-or-nothing  ${kept.kept.length}   (${kept.discarded} discarded)`);
  say(`     present and failing     settle-each     ${settled.kept.length}   (${fromUnfinished(rows, settled.kept)} from an unfinished source)`);
  check("removal yields more than keeping", removed.kept.length > kept.kept.length,
    `${removed.kept.length} > ${kept.kept.length}`);
  check("which is the OPPOSITE of p13, where they were equal", removed.kept.length !== kept.kept.length);

  say("\n  4. the pile can still be asked, because each record names its origin");
  check("every record carries `from`", settled.kept.every((r) => typeof r.from === "string"));
  check("so `2 of 7 came from a source that did not finish` is computable",
    fromUnfinished(rows, settled.kept) === 2 && settled.kept.length === 7,
    "a sentence no count can produce");

  return done();
}

// ATTACK:
//   a. drop `from` from the records  ->  section 4 must go red, and the "2 of 7"
//      sentence must become unsayable rather than merely wrong.
//   b. let all-or-nothing keep the partial work  ->  section 3 goes red.
//   c. make short-batch throw too  ->  section 1 goes red; the control is gone.
//   d. give a source its own `finished` field and trust it  ->  nothing here
//      goes red, which is the point of section 2. Show me a case where trusting
//      it is CHEAPER than observing it — a source that knows it is about to
//      break has information this harness discards, and I gave it no channel.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
