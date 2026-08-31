import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "RepoReplay",
  description: "Trace Next.js repository evolution to source evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${ibmPlexMono.variable}`}>
        <a className="fixed left-3 top-3 z-50 -translate-y-[180%] bg-ink px-4 py-3 text-void focus:translate-y-0" href="#main-content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
