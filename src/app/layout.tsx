import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Link2 } from "lucide-react";
import { NavLink } from "@/components/nav-link";
import "./globals.css";

const sans = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Backlink Monitor",
  description: "Щоденна перевірка куплених посилань",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <Link2 className="size-4" />
              </span>
              <span className="hidden sm:inline">Backlink Monitor</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/">Посилання</NavLink>
              <NavLink href="/outreachers">Аутричери</NavLink>
              <NavLink href="/import">Імпорт CSV</NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
