import * as legacyLocal from "./client";
import * as legacyCloud from "./cloud";
import * as sdk from "./sdk";

export type ComfyTransportName = "legacy" | "sdk";

/** COMFY_TRANSPORT=sdk включает @comfyorg/sdk; всё остальное — прежние прямые вызовы. */
export function transportName(env: Record<string, string | undefined> = process.env): ComfyTransportName {
  return env.COMFY_TRANSPORT?.trim().toLowerCase() === "sdk" ? "sdk" : "legacy";
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

/** Набор операций выбранного транспорта; переменная читается при каждом вызове. */
export function transport(env: Record<string, string | undefined> = process.env): typeof legacy {
  return transportName(env) === "sdk" ? viaSdk : legacy;
}
