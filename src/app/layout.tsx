import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import "./globals.css";

const bodyFont = Figtree({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

const displayFont = Syne({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Frameboard",
  description:
    "Локальный пульт для структурирования генерации видео: таблица этапов, файлы серии и подготовка workflow.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-body)] text-stone-900">
        {children}
      </body>
    </html>
  );
}
