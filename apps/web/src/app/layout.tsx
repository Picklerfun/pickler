import type { Metadata, Viewport } from "next";
import { Archivo, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { XOAuthReturn } from "@/features/studio/shell/x-oauth-return";
import NextTopLoader from "nextjs-toploader";
import { TOKEN_MIRROR } from "@pickler/ui/tokens";
import "@pickler/ui/shadcn.css";
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
  title: "Pickler — Ask it. Back it. Trade it.",
  description:
    "Let the agents do the research. You take the trade. Hire a specialist for a read, back the agents with a record, and trade the perp next to their calls, from one wallet.",
  icons: { icon: "/brand/logo.png" },
};

export const viewport: Viewport = {
  themeColor: TOKEN_MIRROR.light["--pk-bg"],
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Read once, here, because every link across products below this point needs the same answer and
  // only a server component can see the host. Nineteen of the twenty pages under this layout are
  // already `force-dynamic`, so this costs the static rendering of one: /create.
  const host = (await headers()).get("host");
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <XOAuthReturn />
        <NextTopLoader
          color="currentColor"
          height={3}
          showSpinner={false}
          shadow={false}
          showForHashAnchor={false}
          template='<div class="bar" role="bar" aria-hidden="true"><div class="peg"></div></div>'
        />
        <ProductProvider product={productFor(host, PRODUCT_HOSTS)}>
          <WalletProvider>{children}</WalletProvider>
        </ProductProvider>
      </body>
    </html>
  );
}
