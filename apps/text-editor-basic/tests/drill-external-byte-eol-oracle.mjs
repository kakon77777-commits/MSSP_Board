// Mutation drill for the external byte/EOL oracle.
//
// Mutations run from temporary module copies selected through the test's
// explicit MSSP_EXTERNAL_ORACLE_MODULE seam. The canonical oracle is never
// overwritten, and its digest is checked before and after the run.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const ORACLE = path.join(here, "oracles", "file-byte-eol-oracle.mjs");
const TEST = path.join(here, "external-byte-eol-oracle.test.mjs");

const ATTACKS = [
  {
    label: "chunked reader corrupts one byte",
    from: "  return Buffer.concat(chunks);",
    to: "  return Buffer.concat(chunks).map((byte, index) => index === 0 ? byte ^ 0xff : byte);",
  },
  {
    label: "both readers normalize CRLF to LF",
    from: "  const wholeBytes = Buffer.from(whole);\n  const chunkedBytes = Buffer.from(chunked);",
    to: "  const wholeBytes = Buffer.from(Buffer.from(whole).toString(\"utf8\").replace(/\\r\\n/g, \"\\n\"), \"utf8\");\n"
      + "  const chunkedBytes = Buffer.from(Buffer.from(chunked).toString(\"utf8\").replace(/\\r\\n/g, \"\\n\"), \"utf8\");",
  },
  {
    label: "CRLF pairs are misclassified as lone LF",
    from: "        crlf += 1;\n        index += 1;",
    to: "        lf += 1;\n        index += 1;",
  },
  {
    label: "actual mismatches are forced to pass",
    from: "    status: issues.length === 0 ? \"pass\" : \"actual_mismatch\",\n"
      + "    exit_code: issues.length === 0 ? 0 : 1,",
    to: "    status: \"pass\",\n    exit_code: 0,",
  },
  {
    label: "reader agreement is asserted instead of compared",
    from: "    agree: wholeBytes.equals(chunkedBytes),",
    to: "    agree: true,",
  },
  {
    label: "UTF-8 BOM classification is inverted",
    from: '    ? "utf8"\n    : "none";',
    to: '    ? "none"\n    : "utf8";',
  },
  {
    label: "chunked reader returns only its first chunk",
    from: "      chunks.push(Buffer.from(scratch.subarray(0, count)));",
    to: "      chunks.push(Buffer.from(scratch.subarray(0, count)));\n      break;",
  },
  { label: "CONTROL. change nothing", control: true },
];

const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function runTests(modulePath) {
  return spawnSync(process.execPath, ["--test", TEST], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, MSSP_EXTERNAL_ORACLE_MODULE: modulePath },
  });
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-external-byte-eol-oracle — can the independent oracle fail?");

  if (!fs.existsSync(ORACLE)) {
    say("  REFUSING: oracle module does not exist.");
    return { bad: 1 };
  }

  const original = fs.readFileSync(ORACLE, "utf8");
  const before = digest(ORACLE);
  let green = 0;
  let didNotApply = 0;
  let controlFailed = false;

  for (const attack of ATTACKS) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mssp-oracle-drill-"));
    const candidate = path.join(sandbox, "file-byte-eol-oracle.mjs");
    let applied = true;
    let source = original;
    if (!attack.control) {
      if (!source.includes(attack.from)) applied = false;
      else source = source.replace(attack.from, attack.to);
    }

    let verdict;
    if (!applied) {
      verdict = "DID NOT APPLY — measured nothing";
      didNotApply += 1;
    } else {
      fs.writeFileSync(candidate, source, "utf8");
      const result = runTests(candidate);
      const failed = result.status !== 0;
      const summary = (result.stdout ?? "").match(/^ℹ fail (\d+)\s*$/m);
      const failureCount = summary ? Number(summary[1]) : 1;
      if (attack.control) {
        verdict = failed ? `CONTROL RED (${failureCount})` : "green, as a control must be";
        if (failed) controlFailed = true;
      } else if (failed) {
        verdict = `red, ${failureCount} test(s)`;
      } else {
        verdict = "GREEN — not noticed";
        green += 1;
      }
    }

    assertSafeSandbox(sandbox);
    fs.rmSync(sandbox, { recursive: true, force: true });
    say(`  ${attack.label.padEnd(52)} ${verdict}`);
  }

  const unchanged = digest(ORACLE) === before;
  say(`\n  canonical oracle unchanged: ${unchanged}`);
  say(`  ${ATTACKS.length} drills, ${green} green, ${didNotApply} did not apply`
    + `${controlFailed ? ", CONTROL FAILED" : ""}${unchanged ? "" : ", CANONICAL CHANGED"}`);
  const bad = green + didNotApply + (controlFailed ? 1 : 0) + (unchanged ? 0 : 1);
  return { bad };
}

function assertSafeSandbox(sandbox) {
  if (!path.basename(sandbox).startsWith("mssp-oracle-drill-")) {
    throw new Error(`refusing to remove unexpected drill directory: ${sandbox}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run().bad === 0 ? 0 : 1;
}
