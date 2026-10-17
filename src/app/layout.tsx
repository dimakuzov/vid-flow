import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import { LangAttr } from "@/components/language";
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
    "Local board for structuring video generation: the stage table, series files, and workflow setup.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-body)] text-stone-900">
        <LangAttr />
        {children}
      </body>
    </html>
  );
}
