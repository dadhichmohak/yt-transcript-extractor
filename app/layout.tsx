import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube Transcript Extractor",
  description: "Paste a YouTube link and get a clean, copy-ready transcript. Free, no sign-up, no API key.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
