import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { gateway } from "ai";
import type { ImageModel, LanguageModel } from "ai";

import { getConfig, type ProviderConfig } from "./config.js";
import type { Modality } from "./models.js";

const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible>>();

export function resetProviderCache(): void {
  providerCache.clear();
}

type GatewayVideoModel = ReturnType<typeof gateway.video>;
type ResolvedModel = LanguageModel | ImageModel | GatewayVideoModel;

export function resolveModel(modality: "text", modelId: string): LanguageModel;
export function resolveModel(modality: "image", modelId: string): ImageModel;
export function resolveModel(modality: "video", modelId: string): GatewayVideoModel;
export function resolveModel(
  modality: Modality,
  modelId: string
): ResolvedModel {
  const provider = getConfig().modelProviders.get(modelId);
  if (!provider) {
    return resolveGatewayModel(modality, modelId);
  }

  if (modality === "video") {
    throw new Error(
      `Model ${modelId} uses custom provider "${provider.name}", which does not support video`
    );
  }

  const providerModelId = stripProviderPrefix(modelId, provider.name);
  const client = getProviderClient(provider);

  if (modality === "text") return client(providerModelId);
  return client.imageModel(providerModelId);
}

function resolveGatewayModel(modality: Modality, modelId: string) {
  if (modality === "text") return gateway(modelId);
  if (modality === "image") return gateway.image(modelId);
  return gateway.video(modelId);
}

function getProviderClient(provider: ProviderConfig) {
  const existing = providerCache.get(provider.name);
  if (existing) return existing;
  const client = createOpenAICompatible({
    name: provider.name,
    baseURL: provider.baseUrl,
    apiKey: provider.apiKey,
  });
  providerCache.set(provider.name, client);
  return client;
}

function stripProviderPrefix(modelId: string, providerName: string): string {
  const prefix = `${providerName}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}
