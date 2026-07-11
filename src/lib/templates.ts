/**
 * Шаблоны промптов по умолчанию (редактируются на экране «Настройки»,
 * хранятся в settings под ключами tpl_breakdown / tpl_storyboard / tpl_video).
 *
 * Плейсхолдер шаблона разбивки сюжета: {{STORY}} (поддерживается и
 * [ВСТАВИТЬ ТЕКСТ]) — сюда подставляется литературный сюжет эпизода.
 *
 * Плейсхолдеры шаблона раскадровки, подставляются при сборке:
 *  {{GRID}}            — 3x3 | 2x2
 *  {{PANELS}}          — 9 | 4
 *  {{REFERENCES}}      — строки «Use reference image N as …» по порядку прикрепления
 *  {{STORY}}           — сюжет (вся серия по битам или действие шота)
 *  {{PANEL_STRUCTURE}} — структура панелей под выбранную сетку
 */

/**
 * Правила хронометража — используются и в шаблоне разбивки по умолчанию,
 * и при переделке отдельной группы по замечанию (llmReviseGroup).
 */
/**
 * Правила языка и имён собственных — применяются программно (как TIMING_RULES),
 * поверх редактируемого шаблона, чтобы не зависеть от правок пользователя.
 */
export const LANGUAGE_RULES = `Язык вывода и имена собственные (обязательно):
* Определи язык исходного текста сюжета и выдай ВЕСЬ результат на этом же языке: сюжет на английском → все названия групп, планы, описания действий и ремарки на английском; сюжет на русском → на русском. Текст реплик (dialogue) оставляй на языке сюжета.
* Все имена собственные (персонажи, локации, бренды, организации) ВСЕГДА пиши латиницей по-английски, даже если в исходном тексте они кириллицей: Саймон → Simon, Дэмиен → Damien, Эшфорд → Ashford. Это относится к прозе, названиям групп и к полям characters[] / location.
* Если персонаж или локация есть в библии выше — используй как имя ИМЕННО её element_name (канонический латинский токен) во всех полях, чтобы имена были единообразны и приложение связало сущность автоматически.`;

export const TIMING_RULES = `Хронометраж оценивай реалистично и плотно — каждая лишняя секунда сжигает бюджет генерации:

* реплика: примерно 2–3 слова в секунду плюс до 1 секунды на реакцию собеседника;
* простое действие без слов (проход, поворот головы, взгляд, жест): 2–4 секунды, не больше;
* атмосферный кадр или «камера наблюдает»: не длиннее 3 секунд, и только если он работает на сюжет;
* если шот можно сократить без потери смысла — сокращай;
* при этом не комкай: ключевым эмоциональным реакциям и паузам оставляй 2–3 секунды воздуха;
* внутри группы время шотов отсчитывается от 00:00 — каждая группа это отдельное видео.`;

export const DEFAULT_BREAKDOWN_TEMPLATE = `Ты — профессиональный AI Creator и режиссёр вертикальной Boys Love Dark Romance драмы.

Проанализируй предоставленный текст эпизода и создай сюжетную раскадровку для последующей AI-генерации видео.

Используй только персонажей, локации, события и диалоги из текста эпизода. Ничего не добавляй и не меняй порядок событий.

Сначала кратко укажи:

* сюжет эпизода;
* действующих персонажей;
* показанные локации.

Затем разбей весь сюжет на последовательные шоты с диалогами и хронометражем.

Общая продолжительность эпизода: 3–5 минут.

Учитывай формат динамичной драмы для социальных сетей:

* не растягивай паузы и простые действия;
* оставляй достаточно времени для произнесения реплик и эмоциональных реакций;
* не дроби простое действие на лишние шоты;
* используй преимущественно средние и крупные планы в диалоговых сценах.

${TIMING_RULES}

Объедини шоты в группы продолжительностью не более 15 секунд. Каждая группа должна быть пригодна для отдельной AI-видеогенерации.

Нельзя:

* разрывать реплику между группами;
* заканчивать группу посередине активного действия;
* начинать новую группу с середины реплики или действия.

Новую группу начинай с нового действия, ракурса, реакции или сюжетного момента.

Формат:

# ГРУППА 01 — «Название»

**Время:** 00:00–00:XX
**Локация:**
**Персонажи:**

### Шот 1 — 00:00–00:XX

* **План и ракурс:**
* **Что видит камера:**
* **Действие и эмоция:**
* **Диалог:**

### Шот 2 — 00:XX–00:XX

* **План и ракурс:**
* **Что видит камера:**
* **Действие и эмоция:**
* **Диалог:**

Для каждого шота конкретно указывай, кто находится в кадре, где расположен, куда смотрит, что делает и что меняется к концу шота.

В конце укажи общую продолжительность, количество групп и количество шотов.

ТЕКСТ ЭПИЗОДА:

{{STORY}}`;

export const DEFAULT_STORYBOARD_TEMPLATE = `Create a {{GRID}} image grid ({{PANELS}} panels) that tells a cinematic visual story based on the attached reference images.
{{REFERENCES}}
Maintain character consistency, facial features, clothing, environment style, color grading, and lighting mood across all {{PANELS}} panels.

Story to visualize:
{{STORY}}

Panel structure:
{{PANEL_STRUCTURE}}

Make it visually dynamic:
- Vary camera angles (wide shot, close-up, over-the-shoulder, cinematic perspective)
- Use expressive lighting and atmosphere
- Keep storytelling clear without text
- Film still style, high detail, cinematic composition
- Consistent art style
- Natural transitions between frames

The final result must look like a cohesive storyboard or movie scene grid.
The canvas is vertical 9:16 and every panel is a vertical 9:16 frame.`;

export const PANEL_STRUCTURE_9 = `1. Introduction – establish the scene and mood.
2. Character motivation – show intention or desire.
3. First action – the story begins moving.
4. Rising tension – complication appears.
5. Turning point – dramatic or emotional shift.
6. Escalation – action intensifies.
7. Climax – peak emotional or action moment.
8. Resolution – consequences or aftermath.
9. Final frame – strong cinematic ending shot.`;

export const PANEL_STRUCTURE_4 = `1. Introduction – establish the scene, mood and character intention.
2. Rising tension – the story moves, a complication appears.
3. Climax – peak emotional or action moment.
4. Final frame – resolution, strong cinematic ending shot.`;

export const DEFAULT_VIDEO_TEMPLATE = `Ты пишешь профессиональные промпты для AI-видео и AI-изображений: Seedance 2.0, Kling, Grok Image/Video, Nano Banana Pro, Flux.

Моя задача — получать готовые промпты для сцен вертикального сериала. Мне не нужны длинные объяснения перед промптом. Сначала давай готовый промпт, потом короткие заметки только если они реально нужны.

ОБЩИЙ СТИЛЬ ПРОМПТОВ:
Пиши промпты точно, кинематографично, но не перегружай.
Не добавляй лишние запреты, если они не решают конкретную проблему.
Главное — ясная композиция, действия по времени, кто где находится, куда смотрит, что делает, что говорит.
Не используй имена собственные, только референсы
В финальный промпт не добавляй текстовый мусор для красоты, только то что действительно важно для модели.

ВАЖНЫЕ ТЕГИ:
@Image1 — всегда стартовый кадр / locked starting frame.
@Image2, @Image3 и т.д. — дополнительные референсы.
Если референс используется только для стиля, одежды, позы или интерьера — явно указывай это.
Пример: "Use @Image2 only as the visual style reference, do not copy its composition."
Не превращай дополнительные референсы в новый фон, если я этого не прошу.

СТРУКТУРА ВИДЕО-ПРОМПТА:
Пиши в формате:

Use @Image1 as the locked starting frame and environment reference.

Use @CharacterName as the locked identity for [character].

Format: vertical 9:16.
Total duration: [X] seconds.
[Single continuous shot / Two-shot sequence / Three-shot sequence].
No subtitles. No text overlays.

GLOBAL CONTINUITY:
Коротко зафиксировать:

* локацию
* время суток
* атмосферу
* одежду персонажей
* кто где находится
* что нельзя менять

CHARACTER APPEARANCE:
Если важно, отдельно описать внешность и одежду:

* персонаж 1: одежда, рост, состояние, эмоция
* персонаж 2: одежда, рост, состояние, эмоция

SHOT 01 — НАЗВАНИЕ ШОТА
Time: 0.0–3.0 sec
Lens: 35mm / 50mm
Camera: medium shot / close-up / wide shot / tracking shot
Framing: кто в кадре, что видно, кто главный объект
Location: где происходит
Lighting: какой свет

Action:
Разбить действие внутри шота по времени, если нужно:
0.0–1.0 sec: действие.
1.0–2.0 sec: действие.
2.0–3.0 sec: действие.

Performance:
Как персонаж должен играть: страх, тревога, злость, нежность, шок, контроль, ревность и т.д.

Audio:
No music.
Нужные звуки: шаги, дыхание, звон металла, больничный монитор, телефонный эффект, скрип пола и т.д.

DIALOGUE LOCK:
Spoken language: English only.
Exact line:
"..."

Do not translate.
Do not add extra words.
No subtitles.

VISUAL STYLE:
Выбрать стиль под сцену:

* Raw phone camera aesthetic.
* Shot on iPhone, available light only.
* Ungraded natural colors.
* Realistic skin tones.
* Slight handheld movement.
* No cinematic filters.
* No glossy music-video look.

Или для dark romance:

* Dark romance thriller atmosphere.
* Natural low-light realism.
* Cold moonlight / warm window light / hospital blue-white light / fireplace glow.
* No cartoon look.
* No polished fantasy glow.

STRICT RULES:
Сюда писать только реально важные запреты:

* Do not change character identity.
* Do not change outfit.
* Do not add subtitles.
* Do not add extra characters.
* Do not change location.
* Do not make the character run/scream/smile/flirt if this ломает сцену.
* Do not add rain / police / blood / gore / etc., если это важно.

МОИ ПРЕДПОЧТЕНИЯ:

1. Не перегружай промпт лишними запретами. Лучше 5–10 точных правил, чем 30 случайных.
2. Если модель часто ошибается в одном месте, усиливай именно это место.
3. Если сцена должна быть короткой — делай 4–6 секунд, не растягивай.
4. Если есть длинная реплика — давай достаточно времени, обычно 8–15 секунд.
5. Для каждой реплики указывай точный текст в кавычках.
6. Диалоги почти всегда на английском.
7. Всегда указывай No subtitles / No text overlays.
8. Если есть телефонный звонок — только голос из телефона должен иметь phone-call effect, голос персонажа в кадре должен быть обычным.
9. Если персонаж смотрит в конкретную сторону — пиши явно: "must look toward the house / window / person while saying the line."
10. Если машина, персонаж или камера должны двигаться в конкретную сторону — пиши screen direction: right edge, left side of frame, moves to the right, exits frame left.
11. Если сцена через окно — явно указывай: персонаж снаружи, действие внутри дома видно только через окно.
12. Если используется @Image2 как референс, уточняй, что именно брать: стиль, интерьер, позу, одежду, персонажа, свет или композицию.
13. Не делай prompt слишком литературным. Нужны конкретные визуальные команды.
14. Всегда сохраняй локацию, одежду, свет, эмоцию, масштаб персонажей и направление взгляда.

КОРОТКИЙ ШАБЛОН ДЛЯ БЫСТРОГО ПРОМПТА:

SEEDANCE 2.0 PROMPT

Use @Start as the locked starting frame and environment reference.
Use @[Character] as the locked character identity.

Format: vertical 9:16.
Duration: [X] seconds.
Single continuous shot.
No subtitles. No text overlays.

Scene:
[Коротко описать локацию, время суток, свет, атмосферу.]

Action:
@[Character] [что делает].
[Куда смотрит.]
[Как двигается.]
[Что говорит, если говорит.]

Dialogue:
@[Character] says in English:
"Exact line."

Performance:
[Эмоция и подача: quietly, shocked, angry, trembling, tender, controlled, etc.]

Camera:
[Medium shot / close-up / wide shot / tracking shot.]
[Static / slow handheld / slow push-in.]
[Что должно быть в кадре.]

Audio:
No music.
[Нужные звуки.]
No subtitles.

Strict rules:
Do not change character identity.
Do not change outfit.
Do not change location.
Do not add extra characters.
Do not add subtitles or text overlays.
[Добавить 3–5 конкретных запретов под сцену.]`;
