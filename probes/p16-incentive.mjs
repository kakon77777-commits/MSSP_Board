// 改良點 16 — the direction of a declaration is set by the POLICY that consumes
// it, and it can be measured with a counterfactual.
//
// This is the probe that breaks 改良點 15's trust criterion, on a policy that is
// not a strawman. It is the one I would attack first.
//
// Full entry: https://thisoneisneok.com/html/mssp/018-who-the-declaration-serves.html
//
//   node probes/p16-incentive.mjs
import { pathToFileURL } from "node:url";
import { harness } from "./_harness.mjs";

const HELD = 6;
const page = (name, declares) => ({
  NAME: name,
  HELD: name === "full-page" ? 3 : HELD,
  collect(budget = 1) {
    const held = this.HELD;
    const take = Math.min(held, budget * 3);
    return { records: Array.from({ length: take }, (_, i) => `${name}-${i + 1}`),
      incomplete_because: take < held && declares ? "more-after-cursor" : null };
  },
});

// honest-page and silent-page hold the SAME amount and hand over the SAME
// amount per unit of budget. The only difference between them is the
// declaration, so any difference in outcome is attributable to it alone.
const SOURCES = {
  "full-page": page("full-page", true),
  "honest-page": page("honest-page", true),
  "silent-page": page("silent-page", false),
};

// Both policies are defensible. A compliance export is right to drop anything
// known-partial; a catalogue sync is right to spend more on a source that just
// said there is more.
const POLICIES = {
  "refuse-declared": (runs) => runs.map((r) => (r.incomplete_because ? { ...r, kept: [] } : { ...r, kept: r.records })),
  "retry-declared": (runs, rerun) => runs.map((r) => (r.incomplete_because
    ? { ...r, kept: rerun(r.source, 2).records } : { ...r, kept: r.records })),
};

const run1 = (name, budget = 1, suppress = false) => {
  const r = SOURCES[name].collect(budget);
  return { source: name, records: r.records, incomplete_because: suppress ? null : r.incomplete_because };
};
const through = (policy, suppress = []) => policy(
  Object.keys(SOURCES).sort().map((n) => run1(n, 1, suppress.includes(n))),
  (n, b) => run1(n, b));
const contribution = (rows, name) => rows.find((r) => r.source === name)?.kept.length ?? 0;

// The counterfactual: same policy, same data, one declaration removed.
const incentive = (policy, name) => {
  const declared = contribution(through(policy), name);
  const suppressed = contribution(through(policy, [name]), name);
  return { declared, suppressed, delta: declared - suppressed };
};

export function run() {
  const { say, check, done } = harness("p16 — who a declaration serves is decided by whoever reads it");

  say("\n  1. the control — two units differing only in the declaration");
  check("honest-page and silent-page hold the same",
    SOURCES["honest-page"].HELD === SOURCES["silent-page"].HELD);
  check("and hand over the same at every budget",
    [1, 2, 3].every((b) => SOURCES["honest-page"].collect(b).records.length
      === SOURCES["silent-page"].collect(b).records.length));
  check("exactly one of them declares at budget 1",
    Boolean(SOURCES["honest-page"].collect(1).incomplete_because)
    !== Boolean(SOURCES["silent-page"].collect(1).incomplete_because));

  say("\n  2. the same declaration, two defensible policies");
  const refuse = incentive(POLICIES["refuse-declared"], "honest-page");
  const retry = incentive(POLICIES["retry-declared"], "honest-page");
  const controlRefuse = incentive(POLICIES["refuse-declared"], "silent-page");
  const controlRetry = incentive(POLICIES["retry-declared"], "silent-page");
  say(`     refuse-declared   honest-page  ${refuse.suppressed} -> ${refuse.declared}   delta ${refuse.delta}`);
  say(`     retry-declared    honest-page  ${retry.suppressed} -> ${retry.declared}   delta +${retry.delta}`);
  say(`     (control)         silent-page  ${controlRetry.suppressed} -> ${controlRetry.declared}   delta ${controlRetry.delta}`);
  check("declaring COSTS under refuse-declared", refuse.delta < 0, `${refuse.delta}`);
  check("declaring PAYS under retry-declared", retry.delta > 0, `+${retry.delta}`);
  check("the same declaration points opposite ways",
    Math.sign(refuse.delta) === -Math.sign(retry.delta));
  check("and the control is unmoved by either",
    controlRefuse.delta === 0 && controlRetry.delta === 0,
    "which is what says the machinery is not just moving numbers");

  say("\n  3. so honesty is rewarded and silence is punished");
  const rows = through(POLICIES["retry-declared"]);
  check("the honest unit ends AHEAD of the silent one holding identical data",
    contribution(rows, "honest-page") > contribution(rows, "silent-page"),
    `${contribution(rows, "honest-page")} vs ${contribution(rows, "silent-page")}`);

  say("\n  4. the repair — SCL states the assumption, the build measures it");
  const assumption = "self-penalising";
  const contradicts = (m) => (assumption === "self-penalising" && m.delta > 0
    ? `declaring left the unit better off by ${m.delta}` : null);
  check("a measured positive contradicts the stated assumption", contradicts(retry) !== null);
  check("a measured negative does not", contradicts(refuse) === null);
  check("and a zero does not", contradicts(controlRetry) === null);

  return done();
}

// ATTACK:
//   a. the counterfactual assumes the two arms are COMPARABLE. p17 makes a unit
//      declare whether its declaration is separable — but that is a second
//      unchecked declaration stacked on the first. Break that stack.
//   b. show a policy where the incentive is positive and the declaration is
//      still worth trusting. If that exists, 改良點 16's fatal-on-contradiction
//      rule is too strong.
//   c. make retry-declared not retry  ->  section 2 goes red.
//   d. give silent-page a different HELD  ->  section 1 goes red; the control dies.
//   e. THE HOST'S VECTORS I CANNOT REACH: quorum skewing and poison-pill
//      masking both need MORE THAN ONE CONSUMER. Every example in this run has
//      exactly one, by construction. This is the open ask.

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
