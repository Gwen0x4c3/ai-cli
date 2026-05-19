import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import type { Modality, ModelEntry } from "./models.js";

interface RawProviderModel {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  type?: unknown;
  modality?: unknown;
  capabilities?: unknown;
  context_length?: unknown;
  contextLength?: unknown;
}

interface RawProviderConfig {
  base_url?: unknown;
  baseUrl?: unknown;
  baseURL?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
  protocol?: unknown;
  models?: unknown;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol: string;
}

export interface ConfigData {
  defaults: Partial<Record<Modality, string>>;
  providers: ProviderConfig[];
  models: ModelEntry[];
  modelProviders: Map<string, ProviderConfig>;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "ai-cli.yaml");
const SUPPORTED_MODALITIES: Modality[] = ["text", "image", "video"];
const SUPPORTED_PROTOCOLS = new Set(["openai"]);

let cached: ConfigData | null = null;

export function resetConfigCache(): void {
  cached = null;
}

export function getConfig(): ConfigData {
  if (cached) return cached;
  cached = loadConfig();
  return cached;
}

function loadConfig(): ConfigData {
  const empty: ConfigData = {
    defaults: {},
    providers: [],
    models: [],
    modelProviders: new Map(),
  };

  const configPath = process.env.AI_CLI_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(configPath)) return empty;

  let raw: unknown;
  try {
    raw = parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    warnConfig(`could not read ${configPath}: ${toMessage(err)}`);
    return empty;
  }

  if (!raw || typeof raw !== "object") return empty;

  const defaults = parseDefaults((raw as { models?: unknown }).models);
  const { providers, models, modelProviders } = parseProviders(
    (raw as { providers?: unknown }).providers
  );

  return { defaults, providers, models, modelProviders };
}

function parseDefaults(raw: unknown): Partial<Record<Modality, string>> {
  if (!raw || typeof raw !== "object") return {};
  const defaults: Partial<Record<Modality, string>> = {};
  for (const modality of SUPPORTED_MODALITIES) {
    const value = (raw as Record<string, unknown>)[modality];
    if (typeof value === "string" && value.trim()) {
      defaults[modality] = value.trim();
    }
  }
  return defaults;
}

function parseProviders(raw: unknown): {
  providers: ProviderConfig[];
  models: ModelEntry[];
  modelProviders: Map<string, ProviderConfig>;
} {
  const providers: ProviderConfig[] = [];
  const models: ModelEntry[] = [];
  const modelProviders = new Map<string, ProviderConfig>();
  if (!raw || typeof raw !== "object") {
    return { providers, models, modelProviders };
  }

  for (const [name, configValue] of Object.entries(raw)) {
    if (!configValue || typeof configValue !== "object") {
      warnConfig(`provider "${name}" must be an object`);
      continue;
    }

    const config = configValue as RawProviderConfig;
    const baseUrl =
      readString(config.base_url) ??
      readString(config.baseUrl) ??
      readString(config.baseURL);
    if (!baseUrl) {
      warnConfig(`provider "${name}" is missing base_url`);
      continue;
    }
    const protocol = readString(config.protocol)?.toLowerCase() ?? "openai";
    if (!SUPPORTED_PROTOCOLS.has(protocol)) {
      warnConfig(`provider "${name}" uses unsupported protocol "${protocol}"`);
      continue;
    }

    const provider: ProviderConfig = {
      name,
      baseUrl,
      apiKey: readString(config.api_key) ?? readString(config.apiKey),
      protocol,
    };
    providers.push(provider);

    if (config.models === undefined) continue;
    if (!Array.isArray(config.models)) {
      warnConfig(`provider "${name}" models must be an array`);
      continue;
    }

    for (const modelValue of config.models) {
      if (!modelValue || typeof modelValue !== "object") {
        warnConfig(`provider "${name}" has invalid model entry`);
        continue;
      }
      const model = modelValue as RawProviderModel;
      const rawId =
        readString(model.id) ??
        readString(model.model) ??
        readString(model.name);
      if (!rawId) {
        warnConfig(`provider "${name}" model is missing id`);
        continue;
      }
      const capabilities = parseCapabilities(model);
      if (capabilities.length === 0) {
        warnConfig(`provider "${name}" model "${rawId}" has no valid type`);
        continue;
      }
      const id = rawId.includes("/") ? rawId : `${name}/${rawId}`;
      if (modelProviders.has(id)) {
        warnConfig(`duplicate model id "${id}" in config`);
        continue;
      }
      const contextLength = parseContextLength(
        model.contextLength ?? model.context_length
      );

      models.push({
        id,
        creator: name,
        capabilities,
        ...(contextLength ? { contextLength } : {}),
      });
      modelProviders.set(id, provider);
    }
  }

  return { providers, models, modelProviders };
}

function parseCapabilities(model: RawProviderModel): Modality[] {
  const type = readString(model.type) ?? readString(model.modality);
  if (type) {
    const parsed = parseModality(type);
    return parsed ? [parsed] : [];
  }
  if (Array.isArray(model.capabilities)) {
    const parsed = model.capabilities
      .map((value) => (typeof value === "string" ? parseModality(value) : null))
      .filter((value): value is Modality => value !== null);
    return [...new Set(parsed)];
  }
  return [];
}

function parseModality(value: string): Modality | null {
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_MODALITIES.includes(normalized as Modality)
    ? (normalized as Modality)
    : null;
}

function parseContextLength(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function warnConfig(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
