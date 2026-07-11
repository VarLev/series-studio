import { getSetting } from "./settings";
import { makeT, type T } from "./i18n";

/** t() для серверных компонентов и экшенов — язык из настроек. */
export async function getT(): Promise<T> {
  return makeT(await getSetting("ui_lang"));
}
