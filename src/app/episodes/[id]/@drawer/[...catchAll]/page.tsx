/**
 * Пустой слот @drawer для ЛЮБОГО под-адреса эпизода (shots/[shotId] и т.п.).
 * Как и соседний page.tsx, закрывает слайдер при client-side навигации: без
 * catch-all слот, открытый на одном экране, «прилипал» бы к следующему, пока
 * не совпадёт с роутом, возвращающим null (docs: parallel-routes → Modals).
 */
export default function DrawerClosedCatchAll() {
  return null;
}
