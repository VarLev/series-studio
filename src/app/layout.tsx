import type { Metadata, Viewport } from "next";
import { Golos_Text, Cinzel, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import SwRegister from "@/components/SwRegister";
import Toaster from "@/components/Toaster";
import AppNav from "@/components/nav/AppNav";
import { ContentShell } from "@/components/nav/NavClient";
import { NavHistoryTracker } from "@/components/nav/NavHistory";
import { I18nProvider } from "@/components/I18nProvider";
import { getAllSettings } from "@/lib/settings";

// язык и тема живут в настройках (БД) — всё приложение рендерится динамически
export const dynamic = "force-dynamic";

const golos = Golos_Text({
  variable: "--font-golos",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});
const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Series Studio",
  description: "AI series production console",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Series Studio" },
};

export const viewport: Viewport = {
  themeColor: "#0a0810",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Слот @panel: вкладки нижнего таб-бара (кроме «Серий») перехватываются
 * intercepting-роутами @panel/(.)* и рендерятся правым слайдером ПОВЕРХ текущего
 * экрана. Основной экран (children) при этом не размонтируется и не теряет
 * состояние — уходим от переоткрытия экранов. Слот живёт именно в КОРНЕВОМ
 * layout, потому что панель должна открываться поверх любого экрана, а не только
 * поверх эпизода (у /episodes/[id] свой слот @drawer для REF и Галереи).
 */
export default async function RootLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  const settings = await getAllSettings();
  return (
    <html lang={settings.ui_lang} data-theme={settings.ui_theme}>
      <body
        className={`${golos.variable} ${cinzel.variable} ${jetbrains.variable} antialiased`}
      >
        <I18nProvider lang={settings.ui_lang}>
          <NavHistoryTracker />
          <AppNav />
          <ContentShell>{children}</ContentShell>
          {panel}
          <Toaster />
          <SwRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
