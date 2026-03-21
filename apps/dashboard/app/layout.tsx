/**
 * Root HTML layout. Configures Inter and JetBrains Mono fonts, sets dark theme,
 * and provides site metadata.
 *
 * @module @maw/dashboard/app/layout
 */
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Maw — Intent-Compiled Private DeFi Agent",
  description:
    "An autonomous DeFi agent that rebalances your portfolio within safe, on-chain constraints",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-bg-primary text-text-primary min-h-screen`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
