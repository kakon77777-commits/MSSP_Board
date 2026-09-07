import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const allowedParent = path.resolve("D:/Ai/work together");
const sha256Text = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function runPowerShell(script, environment) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`ACL helper failed: ${`${result.stderr ?? ""}${result.stdout ?? ""}`.trim()}`);
  }
  return result.stdout.trim();
}

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

export async function withUnreadableEntry(target, readableSibling, run) {
  const resolvedTarget = path.resolve(target);
  const resolvedSibling = path.resolve(readableSibling);
  const normalizedTarget = resolvedTarget.replaceAll("\\", "/");
  const normalizedSibling = resolvedSibling.replaceAll("\\", "/");
  if (!/^D:\/Ai\/work together\/\.mssp-app2-(?:acl|gui)-/.test(normalizedTarget)
      || !/^D:\/Ai\/work together\/\.mssp-app2-(?:acl|gui)-/.test(normalizedSibling)
      || typeof run !== "function" || !lstatSync(resolvedTarget).isFile()
      || !lstatSync(resolvedSibling).isFile()) {
    throw new TypeError("unreadable-entry paths or callback are invalid");
  }
  readFileSync(resolvedSibling);

  const readSddl = [
    "$ErrorActionPreference = 'Stop'",
    "$sections = [System.Security.AccessControl.AccessControlSections]::Access",
    "$acl = [System.IO.File]::GetAccessControl($env:MSSP_ACL_PATH, $sections)",
    "[Console]::Out.Write($acl.GetSecurityDescriptorSddlForm($sections))",
  ].join("\n");
  const denyRead = [
    "$ErrorActionPreference = 'Stop'",
    "$sections = [System.Security.AccessControl.AccessControlSections]::Access",
    "$acl = [System.IO.File]::GetAccessControl($env:MSSP_ACL_PATH, $sections)",
    "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Deny)",
    "$null = $acl.AddAccessRule($rule)",
    "[System.IO.File]::SetAccessControl($env:MSSP_ACL_PATH, $acl)",
    "$after = [System.IO.File]::GetAccessControl($env:MSSP_ACL_PATH, $sections)",
    "[Console]::Out.Write($after.GetSecurityDescriptorSddlForm($sections))",
  ].join("\n");
  const restore = [
    "$ErrorActionPreference = 'Stop'",
    "$sections = [System.Security.AccessControl.AccessControlSections]::Access",
    "$acl = [System.Security.AccessControl.FileSecurity]::new()",
    "$acl.SetSecurityDescriptorSddlForm($env:MSSP_ACL_SDDL, $sections)",
    "[System.IO.File]::SetAccessControl($env:MSSP_ACL_PATH, $acl)",
    "$after = [System.IO.File]::GetAccessControl($env:MSSP_ACL_PATH, $sections)",
    "[Console]::Out.Write($after.GetSecurityDescriptorSddlForm($sections))",
  ].join("\n");

  const aclBefore = runPowerShell(readSddl, { MSSP_ACL_PATH: resolvedTarget });
  let value;
  let callbackError = null;
  let restoreError = null;
  let aclDenied = null;
  try {
    aclDenied = runPowerShell(denyRead, { MSSP_ACL_PATH: resolvedTarget });
    let controlReadErrorCode = null;
    try { readFileSync(resolvedTarget); }
    catch (error) { controlReadErrorCode = error.code ?? error.name; }
    if (controlReadErrorCode === null) {
      throw new Error("unreadable-entry precondition was not proven: direct read succeeded");
    }
    value = await run({
      target: resolvedTarget,
      readableSibling: resolvedSibling,
      proof: {
        preconditionState: "proven",
        aclBeforeSha256: sha256Text(aclBefore),
        aclDeniedSha256: sha256Text(aclDenied),
        controlReadErrorCode,
      },
    });
  } catch (error) {
    callbackError = error;
  } finally {
    try {
      const restored = runPowerShell(restore, {
        MSSP_ACL_PATH: resolvedTarget,
        MSSP_ACL_SDDL: aclBefore,
      });
      if (restored !== aclBefore) throw new Error("ACL restoration is not byte-identical SDDL");
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError !== null) throw restoreError;
  if (callbackError !== null) throw callbackError;
  return { value, cleanupState: "acl-restored" };
}

export async function withRefreshChange(root, manifest, run) {
  const resolvedRoot = path.resolve(root);
  const normalized = resolvedRoot.replaceAll("\\", "/");
  if (!/^D:\/Ai\/work together\/\.mssp-app2-(?:refresh|gui)-/.test(normalized)
      || typeof run !== "function" || !Array.isArray(manifest?.entries)) {
    throw new TypeError("refresh-change root, manifest or callback is invalid");
  }
  const baseRow = manifest.entries.find((entry) => entry.path === "refresh/base.txt");
  if (baseRow?.kind !== "file") throw new TypeError("refresh base fixture is missing");
  const basePath = path.join(resolvedRoot, "refresh", "base.txt");
  const addedPath = path.join(resolvedRoot, "refresh", "external-added.bin");
  const baseBytes = readFileSync(basePath);
  const baseSha256 = crypto.createHash("sha256").update(baseBytes).digest("hex");
  if (baseBytes.length !== baseRow.bytes || baseSha256 !== baseRow.sha256
      || existsSync(addedPath)) {
    throw new Error("refresh-change precondition was not proven");
  }
  const addedBytes = Buffer.from("a1b2c3d4", "hex");
  const addedSha256 = crypto.createHash("sha256").update(addedBytes).digest("hex");
  if (addedSha256 !== "97ed8e55519b020c4d9aceb40e0d3bc7eaa22d080d49592bf21206cb697c8a58") {
    throw new Error("refresh-change expected payload is wrong");
  }

  let value;
  let callbackError = null;
  let cleanupError = null;
  try {
    unlinkSync(basePath);
    writeFileSync(addedPath, addedBytes, { flag: "wx" });
    value = await run({
      root: resolvedRoot,
      basePath,
      addedPath,
      proof: {
        preconditionState: "proven",
        baseSha256,
        addedWasAbsent: true,
      },
    });
  } catch (error) {
    callbackError = error;
  } finally {
    try {
      if (existsSync(addedPath)) {
        const actualAdded = readFileSync(addedPath);
        const actualHash = crypto.createHash("sha256").update(actualAdded).digest("hex");
        if (actualAdded.length !== addedBytes.length || actualHash !== addedSha256) {
          throw new Error("refresh-change cleanup refuses to delete changed added artifact");
        }
        unlinkSync(addedPath);
      }
      if (existsSync(basePath)) {
        throw new Error("refresh-change cleanup refuses to overwrite an unexpected base artifact");
      }
      writeFileSync(basePath, baseBytes, { flag: "wx" });
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError !== null) throw cleanupError;
  if (callbackError !== null) throw callbackError;
  return { value, cleanupState: "restored" };
}
