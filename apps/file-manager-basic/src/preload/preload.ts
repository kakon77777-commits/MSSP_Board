import { contextBridge, ipcRenderer } from "electron";
import type {
  MutationRequestItem,
  SelectionRequestItem,
  SetDestinationRequest,
} from "../sms/file-manager-contract";

const api = Object.freeze({
  chooseRoot: () => ipcRenderer.invoke("file-manager:choose-root"),
  getCurrentDirectory: () => ipcRenderer.invoke("file-manager:get-current-directory"),
  navigate: (generation: number, entryId: string | null) =>
    ipcRenderer.invoke("file-manager:navigate", { generation, entryId }),
  refresh: () => ipcRenderer.invoke("file-manager:refresh"),
  setSelection: (generation: number, items: SelectionRequestItem[]) =>
    ipcRenderer.invoke("file-manager:set-selection", { generation, items }),
  setDestination: (generation: number, request: SetDestinationRequest) =>
    ipcRenderer.invoke("file-manager:set-destination", { generation, request }),
  createDirectory: (generation: number, parentEntryId: string | null, name: unknown) =>
    ipcRenderer.invoke("file-manager:create-directory", { generation, parentEntryId, name }),
  renameEntries: (generation: number, items: MutationRequestItem[], name: unknown) =>
    ipcRenderer.invoke("file-manager:rename", { generation, items, name }),
  copyEntries: (generation: number, items: MutationRequestItem[], destinationDirectoryId: string | null) =>
    ipcRenderer.invoke("file-manager:copy", { generation, items, destinationDirectoryId }),
  moveEntries: (generation: number, items: MutationRequestItem[], destinationDirectoryId: string | null) =>
    ipcRenderer.invoke("file-manager:move", { generation, items, destinationDirectoryId }),
  trashEntries: (generation: number, items: MutationRequestItem[]) =>
    ipcRenderer.invoke("file-manager:trash", { generation, items }),
});

contextBridge.exposeInMainWorld("fileManager", api);
