import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const allowedParent = path.resolve("D:/Ai/work together");

function timeoutAfter(milliseconds, label) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    timer.unref?.();
  });
}

async function firstLine(stream, child) {
  stream.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      resolve(buffer.slice(0, newline).trim());
    };
    const onExit = (code) => { cleanup(); reject(new Error(`lock helper exited before ready: ${code}`)); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      stream.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    stream.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function releaseExactChild(child) {
  if (child.exitCode !== null) return;
  child.stdin.write("\n");
  child.stdin.end();
  try {
    await Promise.race([once(child, "exit"), timeoutAfter(5_000, "lock helper release")]);
  } catch (error) {
    child.kill("SIGKILL");
    if (child.exitCode === null) {
      await Promise.race([once(child, "exit"), timeoutAfter(5_000, "lock helper kill")]);
    }
    throw error;
  }
}

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

export async function withLockedMember(source, destination, run) {
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  const normalizedSource = resolvedSource.replaceAll("\\", "/");
  const normalizedDestination = resolvedDestination.replaceAll("\\", "/");
  if (!normalizedSource.startsWith("D:/Ai/work together/.mssp-app2-lock-")
      || !normalizedDestination.startsWith("D:/Ai/work together/.mssp-app2-lock-")
      || typeof run !== "function" || !lstatSync(resolvedSource).isFile()
      || existsSync(resolvedDestination)) {
    throw new TypeError("locked-member paths or callback are invalid");
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$stream = [System.IO.File]::Open($env:MSSP_LOCK_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)",
    "$handle = ('0x{0:x}' -f $stream.SafeFileHandle.DangerousGetHandle().ToInt64())",
    "$ready = [ordered]@{ pid = $PID; handle = $handle } | ConvertTo-Json -Compress",
    "[Console]::Out.WriteLine($ready)",
    "[Console]::Out.Flush()",
    "[Console]::In.ReadLine() | Out-Null",
    "$stream.Dispose()",
  ].join("\n");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, MSSP_LOCK_PATH: resolvedSource },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let value;
  let callbackError = null;
  let cleanupError = null;
  try {
    const line = await Promise.race([
      firstLine(child.stdout, child),
      timeoutAfter(10_000, "lock helper ready"),
    ]);
    const ready = JSON.parse(line);
    let controlErrorCode = null;
    try {
      renameSync(resolvedSource, resolvedDestination);
      renameSync(resolvedDestination, resolvedSource);
    } catch (error) {
      controlErrorCode = error.code ?? error.name;
    }
    if (controlErrorCode === null) {
      throw new Error("locked-member precondition was not proven: control move succeeded");
    }
    value = await run({
      source: resolvedSource,
      destination: resolvedDestination,
      proof: {
        preconditionState: "proven",
        helperPid: ready.pid,
        handle: ready.handle,
        controlMoveFailed: true,
        controlErrorCode,
      },
    });
  } catch (error) {
    callbackError = error;
  } finally {
    try { await releaseExactChild(child); }
    catch (error) { cleanupError = error; }
  }
  if (callbackError !== null) throw callbackError;
  if (cleanupError !== null) throw cleanupError;
  return { value, cleanupState: "released" };
}
