/**
 * В системный промпт фабрики уходят только первые N символов каждого документа
 * базы знаний — длиннее режем (см. knowledgeContext в llm/factory.ts). Вкладка
 * «База знаний» предупреждает об обрезке этим же числом.
 */
export const KNOWLEDGE_EXCERPT_CHARS = 6000;

/**
 * Автотеги документа базы знаний по имени файла/названию и началу текста.
 * Теги решают, в промпты какого семейства подмешивается документ
 * (см. knowledgeContext в llm/factory.ts); правятся вручную на вкладке
 * «База знаний».
 */
export function guessKnowledgeTags(fileName: string, content: string): string {
  const tags: string[] = [];
  const haystack = (fileName + " " + content.slice(0, 2000)).toLowerCase();
  for (const key of ["kling", "seedance", "grok", "nano banana", "soul", "camera", "realism", "avatar"]) {
    if (haystack.includes(key)) tags.push(key.replace(" ", "-"));
  }
  if (haystack.includes("камер") || haystack.includes("dolly") || haystack.includes("crane")) {
    if (!tags.includes("camera")) tags.push("camera");
  }
  return tags.length ? tags.join(",") : "general";
}
