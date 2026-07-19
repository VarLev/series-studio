/**
 * Пустой слот @drawer на самом эпизоде (/episodes/[id]). Нужен именно как page,
 * а не default: default.tsx срабатывает лишь при полной перезагрузке, а при
 * закрытии слайдера client-side навигацией (router.replace на адрес эпизода)
 * слот сохраняет прежний контент, пока не заматчится роут, возвращающий null.
 * Без этого файла слайдер refs/gallery не закрывался — спасала только перезагрузка.
 */
export default function DrawerClosedOnEpisode() {
  return null;
}
