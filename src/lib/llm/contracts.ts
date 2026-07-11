import { z } from "zod";

/**
 * Раскадровка v2: шаблон заказчика (tpl_breakdown) даёт группы шотов
 * (единица AI-видеогенерации ≤15 сек), внутри каждой — шоты с таймингом.
 */
export const groupShotSchema = z.object({
  order: z.number().int(),
  time: z.string().default(""), // «00:00–00:05»
  framing: z.string().default(""), // план и ракурс
  camera: z.string().default(""), // что видит камера
  action: z.string().default(""), // действие и эмоция
  dialogue: z.string().default(""),
});
export type GroupShot = z.infer<typeof groupShotSchema>;

export const breakdownSchema = z.object({
  summary: z.string().default(""),
  characters: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  groups: z.array(
    z.object({
      order: z.number().int(),
      title: z.string().default(""),
      time: z.string().default(""), // «00:00–00:14»
      duration_sec: z.number().int().min(1).max(60).default(15),
      location: z.string().default(""),
      characters: z.array(z.string()).default([]),
      shots: z.array(groupShotSchema).default([]),
    }),
  ),
});
export type Breakdown = z.infer<typeof breakdownSchema>;

/** Переделка одной группы по замечанию пользователя (llmReviseGroup). */
export const groupPatchSchema = z.object({
  title: z.string().default(""),
  duration_sec: z.number().int().min(1).max(60).default(15),
  shots: z.array(groupShotSchema).default([]),
});
export type GroupPatch = z.infer<typeof groupPatchSchema>;

/** TZ §7 — Промпт шота */
export const shotPromptSchema = z.object({
  prompt: z.string(),
  negative_prompt: z.string().optional().default(""),
  reference_element_names: z.array(z.string()).default([]),
  /** id использованных режиссёрских приёмов из библиотеки (бейджи 🎥 под промптом) */
  used_technique_ids: z.array(z.string()).default([]),
  params: z
    .object({
      aspect_ratio: z.string().default("16:9"),
      duration: z.number().default(15),
    })
    .default({ aspect_ratio: "16:9", duration: 15 }),
});
export type ShotPrompt = z.infer<typeof shotPromptSchema>;

/** Этап подбора приёмов: Haiku выбирает кандидатов из индекса библиотеки. */
export const techniquePickSchema = z.object({
  ids: z.array(z.string()).default([]),
});
