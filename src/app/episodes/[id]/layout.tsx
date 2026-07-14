/**
 * Layout эпизода со слотом @drawer: intercepting-роуты (.)refs и (.)gallery
 * рендерятся в этот слот правым слайдером ПОВЕРХ текущего экрана — без
 * перезагрузки и потери состояния. Прямой URL/перезагрузка тех же адресов
 * открывает их полными страницами (слот падает в default → null).
 */
export default function EpisodeLayout({
  children,
  drawer,
}: {
  children: React.ReactNode;
  drawer: React.ReactNode;
}) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
