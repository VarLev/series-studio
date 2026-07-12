import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite тянет wasm-ассеты — бандлинг ломает его файловую систему
  serverExternalPackages: ["@electric-sql/pglite"],
  // /knowledge читается в рантайме (база знаний промпт-фабрики) — включаем в деплой
  outputFileTracingIncludes: {
    "/costs": ["./knowledge/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Клиентский кэш роутера: повторный переход на недавно открытый экран
    // рисуется мгновенно из кэша (критично через туннель). Данные освежают
    // revalidatePath в actions и GenPoller, поэтому 30 с безопасны.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
};

export default nextConfig;
