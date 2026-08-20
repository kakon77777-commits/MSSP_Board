// 改良點 13 — the island test only removes; it never breaks a unit in place.
//
// Full entry: https://thisoneisneok.com/html/mssp/015-present-and-failing.html
//
//   node probes/p13-break-in-place.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const SOURCES = {
  // The control. Zero records and it did NOT fail. Without it, "zero records"
  // and "failure" are one observation and section 2 cannot come out badly.
  "archive-dump": { CAN_FAIL_WITH: ["corrupt-archive"], collect: () => ({ records: [], failed: null }) },
  "local-files": { CAN_FAIL_WITH: ["unreadable-path"], collect: () => ({ records: ["l-1", "l-2"], failed: null }) },
  "remote-index": { CAN_FAIL_WITH: ["unreachable", "timeout"], collect: () => ({ records: [], failed: "unreachable" }) },
};

function gather(absent = []) {
  return Object.keys(SOURCES).sort().map((name) => {
    if (absent.includes(name)) return { source: name, outcome: "absent", records: 0, failed: null };
    const source = SOURCES[name];
    const r = source.collect();
    let problem = null;
    if (!Array.isArray(source.CAN_FAIL_WITH) || source.CAN_FAIL_WITH.length === 0) {
      problem = "the unit declares no failure modes";
    } else if (r.failed && !source.CAN_FAIL_WITH.includes(r.failed)) {
      problem = `observed failure ${r.failed} is not declared`;
    }
    if (problem) {
      return { source: name, outcome: "refused", records: 0, failed: r.failed, problem };
    }
    return {
      source: name,
      outcome: r.failed ? "failed" : (r.records.length ? "worked" : "empty"),
      records: r.records.length,
      failed: r.failed,
      problem: null,
    };
  });
}

const total = (rows) => rows.reduce((n, r) => n + r.records, 0);

export function run() {
  const { say, check, done } = harness("p13 — the island test removes, and cannot break");

  say("\n  1. removing a unit and breaking it produce the same total");
  const removed = gather(["remote-index"]);
  const broken = gather();
  say(`     removed (island test)   ${total(removed)}   outcome=${removed.find((r) => r.source === "remote-index").outcome}`);
  say(`     present and failing     ${total(broken)}   outcome=${broken.find((r) => r.source === "remote-index").outcome}`);
  check("the totals are equal", total(removed) === total(broken), `${total(removed)} = ${total(broken)}`);
  check("and only the outcome differs",
    removed.find((r) => r.source === "remote-index").outcome !== broken.find((r) => r.source === "remote-index").outcome);

  say("\n  2. the control — three situations share one number");
  const dump = broken.find((r) => r.source === "archive-dump");
  const remote = broken.find((r) => r.source === "remote-index");
  check("archive-dump returned zero records", dump.records === 0);
  check("and it did NOT fail — the control", dump.failed === null);
  check("remote-index also returned zero", remote.records === 0);
  check("and it DID fail", remote.failed !== null);
  check("so a count cannot separate them; the outcome field can",
    dump.records === remote.records && dump.outcome !== remote.outcome);

  say("\n  3. a unit that cannot name its failure modes is refused");
  const mute = { CAN_FAIL_WITH: [], collect: () => ({ records: [], failed: null }) };
  check("an empty CAN_FAIL_WITH is a refusal", mute.CAN_FAIL_WITH.length === 0,
    "a unit that cannot say what a bad day looks like cannot be reported as degraded");

  say("\n  4. the observed failure must be one of the declared modes");
  const originalRemote = SOURCES["remote-index"];
  SOURCES["remote-index"] = { ...originalRemote, CAN_FAIL_WITH: ["timeout"] };
  const mismatched = gather().find((r) => r.source === "remote-index");
  SOURCES["remote-index"] = originalRemote;
  check("a timeout-only declaration cannot cover an observed unreachable failure",
    mismatched.outcome === "refused",
    `declared=timeout, observed=${mismatched.failed}, outcome=${mismatched.outcome}`);
  SOURCES["remote-index"] = { ...originalRemote, CAN_FAIL_WITH: [] };
  const undeclared = gather().find((r) => r.source === "remote-index");
  SOURCES["remote-index"] = originalRemote;
  check("an observed failure with no declared modes is refused by the running path",
    undeclared.outcome === "refused",
    `declared=<empty>, observed=${undeclared.failed}, outcome=${undeclared.outcome}`);
  check("the ordinary matching declaration remains a failure observation, not a refusal",
    remote.outcome === "failed" && SOURCES["remote-index"].CAN_FAIL_WITH.includes(remote.failed));

  return done();
}

// ATTACK:
//   a. make archive-dump fail  ->  section 2 must go red. If it does not, the
//      control is doing nothing and the whole entry rests on a check that
//      cannot fail.
//   b. classify `failed` as `empty`  ->  section 2's last check must go red.
//   c. give remote-index one record before failing  ->  the totals stop being
//      equal, and section 1 goes red. That is 改良點 14's subject, not a bug here.
//   d. HARDEST: find a shape where removal and breakage differ in a direction
//      016 and 017 did not find. Three directions are known: equal (this),
//      removal-gives-more (p14), removal-cleans-the-report (p15).
//   e. remove the observed/declaration membership check -> a source declaring
//      only timeout is accepted after reporting unreachable, and section 4
//      goes red.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
