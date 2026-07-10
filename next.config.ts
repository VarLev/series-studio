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
  },
};

export default nextConfig;
