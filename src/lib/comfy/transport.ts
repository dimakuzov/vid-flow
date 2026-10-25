import fs from "fs";
import path from "path";
import { getDataRoot } from "../series/paths";
import * as legacyLocal from "./client";
import * as legacyCloud from "./cloud";
import * as sdk from "./sdk";

export type ComfyTransportName = "legacy" | "sdk";

const SETTING_FILE = "comfy_transport.txt";

function settingPath(): string {
  return path.join(getDataRoot(), SETTING_FILE);
}

/** Выбор из интерфейса доски (data/comfy_transport.txt). null — не выбирали. */
export function readTransportSetting(): ComfyTransportName | null {
  try {
    const value = fs.readFileSync(settingPath(), "utf8").trim();
    return value === "sdk" || value === "legacy" ? value : null;
  } catch {
    return null;
  }
}

export function writeTransportSetting(name: ComfyTransportName): void {
  fs.mkdirSync(getDataRoot(), { recursive: true });
  fs.writeFileSync(settingPath(), name + "\n");
}

function fromEnv(env: Record<string, string | undefined>): ComfyTransportName {
  return env.COMFY_TRANSPORT?.trim().toLowerCase() === "legacy" ? "legacy" : "sdk";
}

/**
 * Транспорт. С явным env (тесты) — только он. Без него: выбор из интерфейса доски,
 * иначе COMFY_TRANSPORT (legacy — прямые вызовы), иначе sdk.
 */
export function transportName(env?: Record<string, string | undefined>): ComfyTransportName {
  if (env) return fromEnv(env);
  return readTransportSetting() ?? fromEnv(process.env);
}

const legacy = {
  uploadComfyImage: legacyLocal.uploadComfyImage,
  submitComfyPrompt: legacyLocal.submitComfyPrompt,
  readComfyHistory: legacyLocal.readComfyHistory,
  readComfyQueue: legacyLocal.readComfyQueue,
  cancelComfyPrompt: legacyLocal.cancelComfyPrompt,
  downloadComfyImage: legacyLocal.downloadComfyImage,
  uploadCloudImage: legacyCloud.uploadCloudImage,
  submitCloudPrompt: legacyCloud.submitCloudPrompt,
  readCloudJob: legacyCloud.readCloudJob,
  downloadCloudFile: legacyCloud.downloadCloudFile,
  cancelCloudJob: legacyCloud.cancelCloudJob,
};

const viaSdk: typeof legacy = {
  uploadComfyImage: sdk.uploadComfyImage,
  submitComfyPrompt: sdk.submitComfyPrompt,
  readComfyHistory: sdk.readComfyHistory,
  readComfyQueue: sdk.readComfyQueue,
  cancelComfyPrompt: sdk.cancelComfyPrompt,
  downloadComfyImage: sdk.downloadComfyImage,
  uploadCloudImage: sdk.uploadCloudImage,
  submitCloudPrompt: sdk.submitCloudPrompt,
  readCloudJob: sdk.readCloudJob,
  downloadCloudFile: sdk.downloadCloudFile,
  cancelCloudJob: sdk.cancelCloudJob,
};

/** Набор операций выбранного транспорта; настройка читается при каждом вызове. */
export function transport(env?: Record<string, string | undefined>): typeof legacy {
  return transportName(env) === "sdk" ? viaSdk : legacy;
}
