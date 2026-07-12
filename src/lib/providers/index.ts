import type { GenerationProvider } from "./types";
import { HiggsfieldProvider } from "./higgsfield";
import { HiggsfieldMcpProvider } from "./higgsfieldMcp";
import { KlingMcpProvider } from "./klingMcp";
import { MockProvider } from "./mock";
import { GoogleImageProvider } from "./google";

export function providerConfigured(): boolean {
  return Boolean(process.env.HIGGSFIELD_API_KEY) && process.env.HIGGSFIELD_MOCK !== "1";
}

/** Видео-провайдер (Higgsfield Cloud API или мок) — синхронный выбор без БД. */
export function getProvider(): GenerationProvider {
  return providerConfigured() ? new HiggsfieldProvider() : new MockProvider();
}

/**
 * Видео-провайдер с учётом Higgsfield MCP: если аккаунт подключён (OAuth,
 * кредиты ПОДПИСКИ) — видео идёт через MCP; иначе Cloud API (отдельный
 * платный кошелёк) при ключе; иначе мок. Проверка подключения читает БД.
 */
export async function pickVideoProvider(): Promise<GenerationProvider> {
  const { isConnected } = await import("@/lib/higgsfieldMcp");
  if (await isConnected()) return new HiggsfieldMcpProvider();
  return getProvider();
}

/**
 * ВСЕ доступные видео-провайдеры (моделей теперь несколько источников:
 * Higgsfield MCP + Kling MCP). Каталог собирается со всех, задача при
 * запуске/поллинге маршрутизируется по generations.provider / video_models.provider.
 */
export async function availableVideoProviders(): Promise<GenerationProvider[]> {
  const out: GenerationProvider[] = [await pickVideoProvider()];
  const { isConnected: klingConnected } = await import("@/lib/klingMcp");
  if (await klingConnected()) out.push(new KlingMcpProvider());
  return out;
}

/** Провайдер по имени (строка из БД); null — неизвестный/отключённый. */
export async function videoProviderByName(name: string): Promise<GenerationProvider | null> {
  const providers = await availableVideoProviders();
  return providers.find((p) => p.name === name) ?? null;
}

/** Google для Nano Banana дешевле и бережёт кредиты Higgsfield под видео.
 *  GEMINI_MOCK=1 включает Google-провайдера в мок-режиме (сэмпл-картинка, без ключа) —
 *  чтобы проверить поток Pro/Light и цены без реального вызова. */
export function googleImageConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.GEMINI_MOCK === "1";
}

/** Image-провайдер: Google Gemini при наличии ключа, иначе видео-провайдер (Higgsfield/мок). */
export function getImageProvider(): GenerationProvider {
  return googleImageConfigured() ? new GoogleImageProvider() : getProvider();
}

export * from "./types";
