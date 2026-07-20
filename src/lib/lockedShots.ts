import type { GroupShot } from "@/lib/llm/contracts";

/**
 * Серверная страховка Enhance для заблокированных (🔒 locked) шотов.
 *
 * Locked-шоты пользователя ОТПРАВЛЯЮТСЯ модели (они занимают время в 15-сек
 * бюджете группы и нужны для связности), а промпт велит вернуть их дословно. Но
 * доверять этому нельзя: модель может разбить, объединить или переписать такой
 * шот. Поэтому после ответа мы восстанавливаем оригиналы поверх модельного
 * результата — ремень и подтяжки. Ключевой случай — модель разрезала locked
 * developing shot на две половинки: обе почти целиком состоят из слов оригинала,
 * ловятся матчингом по словарю и схлопываются обратно в ОДИН шот.
 *
 * Замок — сугубо пользовательское состояние: самовольные locked:true, которые
 * модель могла навесить на свои шоты, сбрасываем (иначе она защитила бы свой же
 * текст от следующего Enhance).
 */

/** Множество значимых токенов шота (для матчинга оригинал↔ответ модели). */
function tokens(b: GroupShot): Set<string> {
  const text = `${b.framing} ${b.camera} ${b.action} ${b.dialogue}`.toLowerCase();
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // прочь пунктуацию, оставляем буквы/цифры
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

/**
 * Доля токенов модельного шота, взятых из оригинала: |tokens(m) ∩ orig| / |tokens(m)|.
 * Высокая у дословного эха (≈1), лёгкой переформулировки и КАЖДОЙ половины разреза
 * (половина — почти целиком слова оригинала). Меряем со стороны m, чтобы поймать
 * именно «шот сделан ИЗ оригинала», а не пересечение больших разных текстов.
 */
function derivedScore(m: GroupShot, origTokens: Set<string>): number {
  const mTokens = tokens(m);
  if (mTokens.size === 0) return 0;
  let inter = 0;
  for (const w of mTokens) if (origTokens.has(w)) inter++;
  return inter / mTokens.size;
}

const DERIVED_THRESHOLD = 0.6;

/** Сквозная перенумерация order = i+1 (иначе коллизии перемешает сортировка normalizeBeats). */
function renumber(shots: GroupShot[]): GroupShot[] {
  return shots.map((s, i) => ({ ...s, order: i + 1 }));
}

/**
 * Восстанавливает заблокированные шоты пользователя поверх результата модели.
 * @param originalMain основные шоты ДО Enhance (источник locked-оригиналов)
 * @param modelMain    основные шоты, вернувшиеся от модели (после чистки приёмов)
 */
export function restoreLockedShots(originalMain: GroupShot[], modelMain: GroupShot[]): GroupShot[] {
  const lockedOrig = originalMain.filter((b) => b.locked);

  // Замков в источнике истины нет — вернуть ответ модели, срезав самовольные замки.
  if (lockedOrig.length === 0) {
    return renumber(modelMain.map((s) => ({ ...s, locked: false })));
  }

  // Работаем на копии, отсортированной по order (как это сделает normalizeBeats).
  type Slot = { shot: GroupShot; used: boolean; deleted: boolean };
  const slots: Slot[] = [...modelMain]
    .sort((a, b) => a.order - b.order)
    .map((shot) => ({ shot, used: false, deleted: false }));

  for (const L of lockedOrig) {
    const lTokens = tokens(L);

    // 1) Матч по словарю: дословное эхо, лёгкая переформулировка или половинки
    //    разреза. Первый матч заменяем оригиналом, остальные — на удаление
    //    (разрез схлопывается обратно в один шот).
    const matches = slots.filter(
      (s) => !s.used && !s.deleted && derivedScore(s.shot, lTokens) >= DERIVED_THRESHOLD,
    );
    if (matches.length > 0) {
      matches[0].shot = { ...L, draft: false, locked: true };
      matches[0].used = true;
      for (let k = 1; k < matches.length; k++) matches[k].deleted = true;
      continue;
    }

    // 2) Фолбэк по флагу: матчей нет (полностью переписан новым словарём), но
    //    модель где-то сохранила locked:true — заменяем первый такой шот.
    const flagged = slots.find((s) => !s.used && !s.deleted && s.shot.locked === true);
    if (flagged) {
      flagged.shot = { ...L, draft: false, locked: true };
      flagged.used = true;
      continue;
    }

    // 3) Фолбэк-вставка: модель выбросила/слила шот — возвращаем оригинал на его
    //    примерное исходное место.
    const at = Math.min(Math.max(originalMain.indexOf(L), 0), slots.length);
    slots.splice(at, 0, {
      shot: { ...L, draft: false, locked: true },
      used: true,
      deleted: false,
    });
  }

  const out = slots
    .filter((s) => !s.deleted)
    // не-восстановленные шоты модели не могут нести замок пользователя
    .map((s) => (s.used ? s.shot : { ...s.shot, locked: false }));
  return renumber(out);
}
