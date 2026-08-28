import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const TEST = path.join(here, "unit-manifest.test.mjs");
const MANIFEST = path.join(
  app,
  "src",
  "tms",
  "encoding",
  "unit.manifest.json",
);

const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const ATTACKS = [
  {
    label: "manifest is absent",
    absent: true,
  },
  {
    label: "schema is changed",
    mutate: (value) => ({ ...value, schema: "mssp.unit/v2" }),
  },
  {
    label: "unit id names another codec",
    mutate: (value) => ({ ...value, unit_id: "tms/other-codec-v1" }),
  },
  {
    label: "role is changed from TMS",
    mutate: (value) => ({ ...value, role: "SMS" }),
  },
  {
    label: "implemented port is removed",
    mutate: (value) => ({ ...value, implements: [] }),
  },
  {
    label: "undeclared sibling import is allowed",
    mutate: (value) => ({
      ...value,
      allowed_imports: [...value.allowed_imports, "tms/other-codec"],
    }),
  },
  {
    label: "forbidden DMS role is removed",
    mutate: (value) => ({
      ...value,
      forbidden_roles: value.forbidden_roles.filter((role) => role !== "dms"),
    }),
  },
  {
    label: "an undeclared key is added",
    mutate: (value) => ({ ...value, note: "extra" }),
  },
  {
    label: "final LF is removed",
    bytes: (original) => original.subarray(0, original.length - 1),
  },
  {
    label: "CONTROL. change nothing",
    control: true,
  },
];

function runTests(manifestPath) {
  return spawnSync(process.execPath, ["--test", TEST], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, MSSP_UNIT_MANIFEST: manifestPath },
  });
}

function serialize(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function run() {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  say("\n=== drill-unit-manifest — can the frozen declaration fail?");

  if (!fs.existsSync(MANIFEST)) {
    say("  REFUSING: canonical unit manifest does not exist.");
    return { bad: 1 };
  }

  const original = fs.readFileSync(MANIFEST);
  const originalValue = JSON.parse(original.toString("utf8"));
  const before = digest(original);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mssp-unit-manifest-"));
  let green = 0;
  let didNotApply = 0;
  let bad = 0;

  try {
    for (const [index, attack] of ATTACKS.entries()) {
      const target = path.join(sandbox, `${index}.unit.manifest.json`);
      let bytes;
      if (attack.absent) {
        bytes = null;
      } else if (attack.bytes) {
        bytes = attack.bytes(original);
      } else if (attack.mutate) {
        bytes = serialize(attack.mutate(structuredClone(originalValue)));
      } else {
        bytes = original;
      }

      if (bytes !== null) fs.writeFileSync(target, bytes);

      if (!attack.control && bytes !== null && bytes.equals(original)) {
        say(`  ${attack.label.padEnd(42)} DID NOT APPLY`);
        didNotApply += 1;
        continue;
      }

      const result = runTests(target);
      if (attack.control) {
        if (result.status === 0) {
          say(`  ${attack.label.padEnd(42)} green, as a control must be`);
        } else {
          say(`  ${attack.label.padEnd(42)} CONTROL FAILED`);
          bad += 1;
        }
      } else if (result.status === 0) {
        say(`  ${attack.label.padEnd(42)} GREEN`);
        green += 1;
      } else {
        const failures = (result.stdout.match(/fail [1-9][0-9]*/g) ?? []).at(-1);
        say(`  ${attack.label.padEnd(42)} red${failures ? `, ${failures}` : ""}`);
      }
    }
  } finally {
    assertSafeSandbox(sandbox);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const unchanged = digest(fs.readFileSync(MANIFEST)) === before;
  say("");
  say(`  canonical manifest unchanged: ${unchanged}`);
  say(
    `  ${ATTACKS.length} drills, ${green} green, ${didNotApply} did not apply`,
  );

  if (!unchanged || green !== 0 || didNotApply !== 0 || bad !== 0) bad += 1;
  return { bad };
}

function assertSafeSandbox(sandbox) {
  const expectedRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(sandbox);
  if (
    path.dirname(resolved) !== expectedRoot ||
    !path.basename(resolved).startsWith("mssp-unit-manifest-")
  ) {
    throw new Error(`refusing to remove unexpected sandbox: ${resolved}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { bad } = run();
  process.exitCode = bad === 0 ? 0 : 1;
}
