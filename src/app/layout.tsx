import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoReplay",
  description: "Trace Next.js repository evolution to source evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="fixed left-3 top-3 z-50 -translate-y-[180%] bg-ink px-4 py-3 text-void focus:translate-y-0" href="#main-content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
