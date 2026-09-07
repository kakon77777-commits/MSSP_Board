import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "..");
const tsc = path.join(app, "node_modules", "typescript", "bin", "tsc");

function compile(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app2-contract-check-"));
  try {
    const config = {
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        moduleResolution: "node",
        strict: true,
        noEmit: true,
        baseUrl: app,
        paths: {
          "@contract": ["src/sms/file-manager-contract"],
          "@ports": ["src/sms/file-manager-ports"],
        },
        skipLibCheck: true,
      },
      files: [path.join(root, "probe.ts")],
    };
    fs.writeFileSync(path.join(root, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
    fs.writeFileSync(path.join(root, "probe.ts"), source);
    return spawnSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], {
      cwd: app,
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const positive = String.raw`
import type {
  DirectorySnapshot, EntryOutcome, MutationResult, RootSelectionResult,
  SelectionResult, CreateDirectoryResult, ViewCommandResult,
  DirectoryObservationResult, RefusalCode, ExecutionFailureCode,
  DestinationCommandResult, DestinationProjection, SetDestinationRequest,
} from "@contract";
import type { FilesystemPort, IdentityPort, RecyclePort, RootPickerPort } from "@ports";

const snapshot: DirectorySnapshot = {
  schema: "fm.directory-snapshot/v1",
  root: { rootId: "r", displayName: "root" }, generation: 1,
  directoryId: null, parentEntryId: null, completeness: "complete",
  entries: [{ entryId: "e", name: "a.txt", kind: "file", byteLength: 1 }],
  observationErrors: [],
  destinationProjection: { state: "none" },
};
const accepted: EntryOutcome = { ordinal: 0, entryId: "e", status: "accepted" };
const refused: EntryOutcome = { ordinal: 1, submittedEntryId: "bad", status: "refused", code: "stale_generation" };
const failed: EntryOutcome = { ordinal: 2, entryId: "e2", status: "failed", code: "filesystem_operation_failed" };
const mutation: MutationResult = { operation: "copy", overallStatus: "partial", outcomes: [accepted, refused, failed], snapshot: { state: "current", snapshot }, evidencePath: "stubbed" };
const root: RootSelectionResult = { status: "cancelled", prior: { snapshot }, evidencePath: "native" };
const selection: SelectionResult = { status: "accepted", outcomes: [{ ordinal: 0, status: "accepted", entryId: "e" }], currentSnapshot: snapshot, evidencePath: "stubbed" };
const create: CreateDirectoryResult = { status: "accepted", createdName: "new", snapshot: { state: "current", snapshot }, evidencePath: "native" };
const view: ViewCommandResult = { operation: "refresh", status: "accepted", snapshot: { state: "current", snapshot }, evidencePath: "native" };
const observation: DirectoryObservationResult = { status: "observed", snapshot: { state: "current", snapshot }, evidencePath: "native" };
const refusal: RefusalCode = "reparse_refused";
const failure: ExecutionFailureCode = "recycle_failed";
const destination: DestinationProjection = { state: "current", entryId: "d", displayName: "dest", isRoot: false };
const destinationCommand: DestinationCommandResult = { operation: "set-destination", status: "accepted", snapshot: { state: "current", snapshot }, evidencePath: "stubbed" };
const destinationRequest: SetDestinationRequest = { mode: "visible-entry", entryId: "e" };
declare const fsPort: FilesystemPort;
declare const ids: IdentityPort;
declare const recycle: RecyclePort;
declare const picker: RootPickerPort;
void [mutation, root, selection, create, view, observation, refusal, failure, destination, destinationCommand, destinationRequest, fsPort, ids, recycle, picker];
`;

const negative = String.raw`
import type { EntryOutcome, RootSelectionResult, SelectionResult, RefusalCode, DestinationProjection, SetDestinationRequest } from "@contract";
const acceptedWithRawInput: EntryOutcome = { ordinal: 0, entryId: "e", submittedEntryId: "e", status: "accepted" };
const failedWithoutPrior: RootSelectionResult = { status: "failed", code: "root_picker_failed", evidencePath: "native" };
const duplicateSelectionList: SelectionResult = { status: "accepted", outcomes: [], selectedEntryIds: [], currentSnapshot: {} as never, evidencePath: "stubbed" };
const freeString: RefusalCode = "whatever";
const destinationMissingRootFlag: DestinationProjection = { state: "current", entryId: "d", displayName: "dest" };
const overloadedNullPin: SetDestinationRequest = null;
void [acceptedWithRawInput, failedWithoutPrior, duplicateSelectionList, freeString, destinationMissingRootFlag, overloadedNullPin];
`;

test("core-v4 SMS DTOs and ports accept the exact intended shapes", () => {
  const run = compile(positive);
  assert.equal(run.status, 0, `positive contract failed to compile:\n${run.stdout}${run.stderr}`);
});

test("core-v4 SMS DTOs reject duplicate identities and free error strings", () => {
  const run = compile(negative);
  assert.notEqual(run.status, 0, "negative contract unexpectedly compiled");
  const output = `${run.stdout}${run.stderr}`;
  assert.match(output, /submittedEntryId|prior|selectedEntryIds|whatever/,
    "the negative probe failed for an unrelated reason");
});
