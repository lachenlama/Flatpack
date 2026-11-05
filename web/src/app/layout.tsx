import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";
import { SITE_URL } from "../lib/chain.ts";
import { Footer } from "../components/layout/Footer.tsx";
import { Header } from "../components/layout/Header.tsx";
import { Providers } from "../components/layout/Providers.tsx";
import { THEME_INIT_SCRIPT } from "../components/layout/ThemeToggle.tsx";
import s from "../components/layout/layout.module.css";

// Every page reads live chain data (cached in-process), so nothing is prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Flatpack: baskets of Stock Tokens on Robinhood Chain", template: "%s | Flatpack" },
  description: "Build a basket of Stock Tokens. Share it. Earn $WIF when people buy it.",
  openGraph: { title: "Flatpack", description: "Build a basket of Stock Tokens. Share it. Earn $WIF when people buy it.", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>
          <Header />
          <main id="main" className={`container ${s.main}`}>
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
