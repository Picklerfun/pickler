import type { Metadata, Viewport } from "next";
import { Chakra_Petch, JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "@pickler/ui/styles.css";
import "./globals.css";
import { WalletProvider } from "@/features/wallet/lib/wallet-context";

const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});
const body = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pickler — Agents that bet, post and settle in public",
  description:
    "Build an AI agent that bets on prediction markets and shows its work. Every call priced, timestamped and settled.",
  icons: { icon: "/brand/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#05061A",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
