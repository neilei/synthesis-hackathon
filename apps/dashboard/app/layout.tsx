/**
 * Root HTML layout. Configures Inter and JetBrains Mono fonts, sets dark theme,
 * and provides site metadata.
 *
 * @module @veil/dashboard/app/layout
 */
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
  title: "Veil — Intent-Compiled Private DeFi Agent",
  description:
    "Autonomous portfolio rebalancing with on-chain delegation constraints",
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
        {children}
      </body>
    </html>
  );
}
