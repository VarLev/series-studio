import { z } from "zod";

/** TZ §7 — Раскадровка: выход JSON {shots:[...]} */
export const breakdownSchema = z.object({
  shots: z.array(
    z.object({
      order: z.number().int(),
      title: z.string().default(""),
      duration_sec: z.number().int().min(3).max(15).default(15),
      action: z.string(),
      entities: z.array(z.string()).default([]),
      camera_hint: z.string().default(""),
    }),
  ),
});
export type Breakdown = z.infer<typeof breakdownSchema>;

/** TZ §7 — Промпт шота */
export const shotPromptSchema = z.object({
  prompt: z.string(),
  negative_prompt: z.string().optional().default(""),
  reference_element_names: z.array(z.string()).default([]),
  params: z
    .object({
      aspect_ratio: z.string().default("16:9"),
      duration: z.number().default(15),
    })
    .default({ aspect_ratio: "16:9", duration: 15 }),
});
export type ShotPrompt = z.infer<typeof shotPromptSchema>;
