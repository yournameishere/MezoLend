import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/shell/Providers";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { fetchMarketsSnapshot } from "@/lib/server-data";

// Re-read market state from the chain at most every 30 seconds for server-rendered pages.
export const revalidate = 30;

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const jbm = JetBrains_Mono({
  variable: "--font-jbm",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mezolend.vercel.app"),
  title: {
    default: "MezoLend: lend and borrow MUSD on Mezo",
    template: "%s · MezoLend",
  },
  description:
    "Supply MUSD to earn from borrowers, or borrow MUSD against your BTC without selling it. Transparent, on-chain lending pools on Mezo.",
  applicationName: "MezoLend",
  openGraph: {
    title: "MezoLend: lend and borrow MUSD on Mezo",
    description: "Supply MUSD. Borrow against bitcoin. Every rate, balance and liquidation is on-chain.",
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
  const seedAt = Date.now();
  return (
    <html lang="en" className={`${archivo.variable} ${jbm.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers seed={seed} seedAt={seedAt}>
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
      </body>
    </html>
  );
}
