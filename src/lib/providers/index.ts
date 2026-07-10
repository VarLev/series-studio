import type { GenerationProvider } from "./types";
import { HiggsfieldProvider } from "./higgsfield";
import { MockProvider } from "./mock";

export function providerConfigured(): boolean {
  return Boolean(process.env.HIGGSFIELD_API_KEY) && process.env.HIGGSFIELD_MOCK !== "1";
}

export function getProvider(): GenerationProvider {
  return providerConfigured() ? new HiggsfieldProvider() : new MockProvider();
}

export * from "./types";
