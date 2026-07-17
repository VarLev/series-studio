/**
 * Бэкап встроенной БД и файлового хранилища: zip всей .data/ с таймстампом в
 * .backups/, хранит последние N архивов. Запускать вручную или по расписанию:
 *   npm run backup
 * Лучше при ОСТАНОВЛЕННОМ сервере — PGlite пишет в .data/pglite, и zip на живой
 * записи может снять несогласованный снимок (WAL в середине транзакции). Второй
 * процесс против PGlite скрипт НЕ поднимает — только читает файлы, поэтому живую
 * БД он не портит (в отличие от запуска превью), но качество бэкапа лучше на покое.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// archiver v8 — ESM, без default-экспорта: фабрика archiver("zip") заменена
// классом ZipArchive (тот же API .directory/.pipe/.finalize/.pointer)
import { ZipArchive } from "archiver";

const KEEP = 10; // сколько последних архивов держать
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data");
const backupsDir = path.join(root, ".backups");

if (!fs.existsSync(dataDir)) {
  console.error(`.data не найдена: ${dataDir} — нечего бэкапить`);
  process.exit(1);
}
fs.mkdirSync(backupsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = path.join(backupsDir, `data-${stamp}.zip`);
const output = fs.createWriteStream(outPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on("close", () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
  console.log(`OK бэкап: ${path.relative(root, outPath)} (${mb} МБ)`);
  // ротация: имена лексикографически сортируемы (ISO-таймстамп) → старые в начале
  const zips = fs
    .readdirSync(backupsDir)
    .filter((f) => /^data-.*\.zip$/.test(f))
    .sort();
  for (const f of zips.slice(0, Math.max(0, zips.length - KEEP))) {
    fs.rmSync(path.join(backupsDir, f), { force: true });
    console.log(`  удалён старый: ${f}`);
  }
});
archive.on("warning", (e) => {
  if (e.code !== "ENOENT") throw e;
});
archive.on("error", (e) => {
  throw e;
});
archive.pipe(output);
archive.directory(dataDir, ".data");
await archive.finalize();
