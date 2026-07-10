import { countActiveGenerations } from "@/lib/generation";
import NavClient from "./NavClient";

export default async function AppNav() {
  let activeJobs = 0;
  try {
    activeJobs = await countActiveGenerations();
  } catch {
    // БД ещё не инициализирована (первый запуск) — навигация без бейджа
  }
  return <NavClient activeJobs={activeJobs} />;
}
