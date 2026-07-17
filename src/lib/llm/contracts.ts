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
  // id закреплённого за этим шотом режиссёрского приёма (из библиотеки), либо ""
  // — проставляется кнопкой Enhance; при генерации промпта его язык вплетается
  technique_id: z.string().default(""),
  // черновой шот (область Draft Shots): полноценный шот-запаска при группе, но
  // НЕ входит в длительность группы, лимит 15 сек и Seedance-промпт. default
  // false → все сохранённые до этой фичи шоты автоматически основные (main)
  draft: z.boolean().default(false),
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
      // время суток и погода (напр. «night, rain») — едины на сюжетную связку
      time_weather: z.string().default(""),
      // эмоциональный тон группы (напр. «calm», «tense, ominous») — свой у каждой группы
      emotional_tone: z.string().default(""),
      // начало новой сюжетной сцены (смена места/времени/непрерывности действия)
      scene_start: z.boolean().default(false),
      characters: z.array(z.string()).default([]),
      // якорь одежды: наряд каждого персонажа в этой группе (outfit — на английском)
      wardrobe: z
        .array(z.object({ name: z.string(), outfit: z.string().default("") }))
        .default([]),
      shots: z.array(groupShotSchema).default([]),
    }),
  ),
});
export type Breakdown = z.infer<typeof breakdownSchema>;

/**
 * Вставные группы (llmInsertGroups): по запросу пользователя модель создаёт
 * 1..N новых групп внутри сцены — форма группы та же, что в раскадровке,
 * но без scene_start (вставки не двигают границы сцен и сквозной таймкод).
 */
export const insertGroupsSchema = z.object({
  groups: z
    .array(
      z.object({
        order: z.number().int(),
        title: z.string().default(""),
        duration_sec: z.number().int().min(1).max(60).default(15),
        location: z.string().default(""),
        time_weather: z.string().default(""),
        emotional_tone: z.string().default(""),
        characters: z.array(z.string()).default([]),
        wardrobe: z
          .array(z.object({ name: z.string(), outfit: z.string().default("") }))
          .default([]),
        shots: z.array(groupShotSchema).default([]),
      }),
    )
    .default([]),
});
export type InsertGroups = z.infer<typeof insertGroupsSchema>;

/**
 * Enhance (llmEnhanceGroup): Opus УЛУЧШАЕТ существующие основные шоты группы (Main),
 * НЕ пересобирая сюжет — шлифует их, дозаполняет поля, при нехватке времени разбивает
 * шот, закрепляет приём (technique_id), уточняет локацию/погоду/тон и возвращает
 * список персонажей, кто РЕАЛЬНО в кадре. Все возвращённые шоты — основные
 * (draft:false); shots_draft оставлен для обратной совместимости, но Enhance его
 * НЕ использует (черновики берутся нетронутыми из текущей группы).
 */
export const enhanceGroupSchema = z.object({
  title: z.string().default(""),
  duration_sec: z.number().int().min(1).max(60).default(15),
  location: z.string().default(""),
  time_weather: z.string().default(""),
  emotional_tone: z.string().default(""),
  // element_name'ы персонажей, реально присутствующих в кадре этой группы
  characters_in_frame: z.array(z.string()).default([]),
  shots: z.array(groupShotSchema).default([]),
  // страховка: Opus иногда кладёт черновики отдельным массивом вместо
  // draft:true внутри shots (реальный инцидент) — принимаем и такой формат,
  // enhanceGroup сольёт их в общий список с draft:true
  shots_draft: z.array(groupShotSchema).default([]),
});
export type EnhanceGroup = z.infer<typeof enhanceGroupSchema>;

/**
 * Переделка одной группы по замечанию пользователя (llmReviseGroup).
 * ТОЛЕРАНТНОСТЬ К ГОЛОМУ МАССИВУ: Sonnet через CLI регулярно отдаёт не объект
 * {title, duration_sec, shots:[…]}, а просто массив шотов [{…},{…}] — особенно
 * при точечной правке одного шота. Раньше это валило валидацию («expected object,
 * received array»), runJson делал вторую попытку (+ещё до 210 с CLI), которая
 * часто упиралась в таймаут — реворк «зависал» на 6+ минут и не применялся
 * (подтверждено логами Console 2026-07-14: пары попыток 169с+210с, 166с+210с).
 * Теперь голый массив принимаем как {shots: [...]} — ретрай не нужен, реворк
 * укладывается в одну попытку (~170 с) и проходит.
 */
export const groupPatchSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { shots: v } : v),
  z.object({
    title: z.string().default(""),
    duration_sec: z.number().int().min(1).max(60).default(15),
    shots: z.array(groupShotSchema).default([]),
  }),
);
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
      // сериал вертикальный — дефолт 9:16 (enforceTemplateInvariants всё равно
      // форсит 9:16, но не оставляем 16:9 в пайплайне вовсе)
      aspect_ratio: z.string().default("9:16"),
      duration: z.number().default(15),
    })
    .default({ aspect_ratio: "9:16", duration: 15 }),
});
export type ShotPrompt = z.infer<typeof shotPromptSchema>;

/** Этап подбора приёмов: дешёвая модель выбирает кандидатов из индекса библиотеки. */
export const techniquePickSchema = z.object({
  ids: z.array(z.string()).default([]),
});

/**
 * Анализ референса шота (стартовый кадр / композиция / layout) vision-моделью.
 * Ролонезависимое описание того, что на картинке — роль применяет промпт-фабрика.
 */
export const referenceAnalysisSchema = z.object({
  // цельное описание на английском: субъекты и их положение, локация/обстановка,
  // свет и настроение — одним компактным абзацем (2–4 предложения)
  description: z.string().default(""),
  // ракурс и кадрирование, ВИДИМЫЕ на картинке (напр. "low-angle medium shot,
  // subject on the left third") — нужно для стартового кадра и композиции
  camera: z.string().default(""),
});
export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>;

/**
 * Сегментация редактируемого шаблона (tpl_breakdown / tpl_video / tpl_video_kling)
 * на отдельные правила для витрины «База правил» (/rules) — llmSegmentTemplate.
 */
export const templateSegmentationSchema = z.object({
  rules: z
    .array(z.object({ title: z.string().default(""), text: z.string() }))
    .min(1),
});
export type TemplateSegmentation = z.infer<typeof templateSegmentationSchema>;

/** Анализ референса персонажа (кнопка «Анализ» в библии, vision-модель). */
export const imageAnalysisSchema = z.object({
  name: z.string().default(""), // имя сущности на английском (транслит собственных имён)
  description: z.string().default(""), // короткий визуальный якорь на английском (без одежды)
  wardrobe: z.string().default(""), // одежда на английском — уходит в промпты как есть
  face_only: z.boolean().default(false), // в кадре только лицо/портрет
  caption: z.string().default(""), // подпись главного референса на английском (если своей нет)
  captions: z.array(z.string()).default([]), // переводы существующих подписей референсов (по порядку)
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;
