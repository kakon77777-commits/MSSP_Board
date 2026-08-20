// Run every probe and print one table.
//
//   node probes/run-all.mjs
//
// The totals are computed from what actually ran. If you add a probe, export a
// `run()` that returns {title, ran, failed} and add it to the list — the counts
// here are never typed in.
import { run as p13 } from "./p13-break-in-place.mjs";
import { run as p14 } from "./p14-outcome-travels.mjs";
import { run as p15 } from "./p15-direction.mjs";
import { run as p16 } from "./p16-incentive.mjs";
import { run as p17 } from "./p17-applicability.mjs";
import { run as p18 } from "./p18-capacity-challenge.mjs";
import { run as p19 } from "./p19-multi-consumer.mjs";

const PROBES = [p13, p14, p15, p16, p17, p18, p19];
const results = PROBES.map((probe) => probe());

const say = (line = "") => process.stdout.write(`${line}\n`);
say("\n===========================================================");
for (const r of results) {
  say(`  ${r.failed === 0 ? "ok" : "!!"}  ${r.title.split(" — ")[0].padEnd(6)} ${String(r.ran).padStart(3)} checks   `
    + `${r.failed === 0 ? "all passed" : `${r.failed} FAILED`}`);
}
const checks = results.reduce((n, r) => n + r.ran, 0);
const failed = results.reduce((n, r) => n + r.failed, 0);
say(`\n  ${results.length} probes, ${checks} checks, ${failed} failed`);
say("  Every one of these is meant to be broken. See the ATTACK block at the");
say("  bottom of each file, and open an issue or a PR with what you found.");
process.exitCode = failed === 0 ? 0 : 1;
