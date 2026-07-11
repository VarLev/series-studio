/** Мono-текст промпта с подсветкой element_name как токенов-чипов. */
export default function PromptText({ text, tokens }: { text: string; tokens: string[] }) {
  const escaped = tokens
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // все токены пустые → regex «()» посимвольно раздробил бы текст
  if (!escaped.length) return <>{text}</>;
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  const lower = new Set(tokens.map((t) => t.toLowerCase()));
  return (
    <>
      {parts.map((part, i) =>
        lower.has(part.toLowerCase()) ? (
          <span key={i} className="prompt-token">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
