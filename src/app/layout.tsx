import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NavLink } from "@/ui/nav-link";
import "./globals.css";

// DESIGN.md: the app UI uses Inter; code uses JetBrains Mono.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Social Publisher",
  description: "Compose a Post once and publish it to many Channels.",
};

// Every screen reads live data from the laptop's database, so nothing is prerendered.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (LanguageTool, Phia) add attributes to <html> before React loads.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col md:flex-row">
        {/* Below 768px the sidebar becomes a top bar with a scrolling row of links. */}
        <aside className="shrink-0 border-b border-border bg-sidebar md:sticky md:top-0 md:flex md:h-screen md:w-[280px] md:flex-col md:border-r md:border-b-0">
          <p className="flex h-12 items-center gap-2 px-4 text-base font-medium md:h-14 md:px-[26px]">
            <span aria-hidden className="size-2 rounded-full bg-parrot" />
            Social Publisher
          </p>
          <nav aria-label="Main" className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:px-3.5 md:pb-0">
            <NavLink href="/" icon="dashboard">
              Dashboard
            </NavLink>
            <NavLink href="/compose" icon="compose">
              Compose
            </NavLink>
            <NavLink href="/posts" icon="posts">
              Posts
            </NavLink>
            <NavLink href="/media" icon="media">
              Media
            </NavLink>
            <NavLink href="/channels" icon="channels">
              Channels
            </NavLink>
            <NavLink href="/brands" icon="brands">
              Brands
            </NavLink>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
