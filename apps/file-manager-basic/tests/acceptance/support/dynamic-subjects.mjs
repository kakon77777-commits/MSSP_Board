import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const allowedParent = path.resolve("D:/Ai/work together");

function assertWithin(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`${label} escapes its allowed parent`);
  }
}

export function withEscapeJunction(root, runId, run) {
  const resolvedRoot = path.resolve(root);
  if (path.parse(resolvedRoot).root.toUpperCase() !== "D:\\"
      || !lstatSync(resolvedRoot).isDirectory()
      || lstatSync(resolvedRoot).isSymbolicLink()) {
    throw new TypeError("junction fixture root must be an ordinary D-drive directory");
  }
  if (!/^[0-9a-f-]{36}$/i.test(runId) || typeof run !== "function") {
    throw new TypeError("junction subject requires a UUID run id and callback");
  }
  assertWithin(allowedParent, resolvedRoot, "fixture root");

  const linkPath = path.join(resolvedRoot, "escape-junction");
  const targetPath = path.join(allowedParent, `escape-target-${runId}`);
  assertWithin(resolvedRoot, linkPath, "junction link");
  assertWithin(allowedParent, targetPath, "junction target");
  if (existsSync(linkPath) || existsSync(targetPath)) {
    throw new Error("junction subject paths must not pre-exist");
  }

  let targetCreated = false;
  let linkCreated = false;
  let value;
  try {
    mkdirSync(targetPath, { recursive: false });
    targetCreated = true;
    symlinkSync(targetPath, linkPath, "junction");
    linkCreated = true;

    const canonicalRoot = realpathSync(resolvedRoot);
    const canonicalTarget = realpathSync(targetPath);
    const proof = {
      preconditionState: "proven",
      kind: lstatSync(linkPath).isSymbolicLink() ? "reparse" : "ordinary",
      targetOutsideRoot: !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`),
      canonicalTarget,
    };
    if (proof.kind !== "reparse" || proof.targetOutsideRoot !== true) {
      throw new Error("junction subject precondition was not proven");
    }
    value = run({ linkPath, targetPath, proof });
  } finally {
    if (linkCreated && existsSync(linkPath)) rmSync(linkPath, { force: true });
    if (targetCreated && existsSync(targetPath)) rmdirSync(targetPath);
  }

  return { value, cleanupState: "restored" };
}
