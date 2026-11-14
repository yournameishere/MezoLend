import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "@/components/shell/Providers";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { fetchMarketsSnapshot } from "@/lib/server-data";

// Re-read market state from the chain at most every 30 seconds for server-rendered pages.
export const revalidate = 30;

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mezolend.vercel.app"),
  title: {
    default: "MezoLend: borrow MUSD against your bitcoin",
    template: "%s · MezoLend",
  },
  description:
    "Borrow MUSD against your BTC without selling it, or lend MUSD and earn what borrowers pay. A lending market with every rate, balance and liquidation on-chain on Mezo.",
  applicationName: "MezoLend",
  openGraph: {
    title: "MezoLend: lend and borrow MUSD on Mezo",
    description: "Borrow dollars against your bitcoin, or lend MUSD and earn. Every rate, balance and liquidation is on-chain on Mezo.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const seed = await fetchMarketsSnapshot();
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers seed={seed.markets} seedAt={seed.at}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
          >
            Skip to content
          </a>
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
