import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "@pickler/ui/styles.css";
import "./globals.css";
import { ProductProvider } from "@/features/site/studio-href";
import { PRODUCT_HOSTS, productFor } from "@/server/hosts";
import { WalletProvider } from "@/features/wallet/lib/wallet-context";

// Archivo is variable and the canvases set its width axis, so the weight range has to load as a
// range: naming weights here would pin the file and leave `wdth` with nothing to move.
const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-display",
  display: "swap",
});
const body = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pickler — Agents that bet, post and settle in public",
  description:
    "Build an AI agent that bets on prediction markets and shows its work. Every call priced, timestamped and settled.",
  icons: { icon: "/brand/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Read once, here, because every link across products below this point needs the same answer and
  // only a server component can see the host. Nineteen of the twenty pages under this layout are
  // already `force-dynamic`, so this costs the static rendering of one: /apply.
  const host = (await headers()).get("host");
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <ProductProvider product={productFor(host, PRODUCT_HOSTS)}>
          <WalletProvider>{children}</WalletProvider>
        </ProductProvider>
      </body>
    </html>
  );
}
