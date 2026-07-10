import type { Metadata, Viewport } from "next";
import { Golos_Text, Cinzel, JetBrains_Mono, EB_Garamond } from "next/font/google";
import "./globals.css";
import SwRegister from "@/components/SwRegister";
import Toaster from "@/components/Toaster";
import AppNav from "@/components/nav/AppNav";
import { ContentShell } from "@/components/nav/NavClient";

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
const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin", "cyrillic"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Series Studio",
  description: "Пульт производства AI-сериала",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Series Studio" },
};

export const viewport: Viewport = {
  themeColor: "#0a0810",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body
        className={`${golos.variable} ${cinzel.variable} ${jetbrains.variable} ${garamond.variable} antialiased`}
      >
        <AppNav />
        <ContentShell>{children}</ContentShell>
        <Toaster />
        <SwRegister />
      </body>
    </html>
  );
}
