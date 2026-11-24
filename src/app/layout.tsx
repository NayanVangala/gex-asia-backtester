import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATAS X · Asia_Template_Fixed | Gold Asia Backtester",
  description:
    "ATAS X Asia Template replica for backtesting the Gold Asia Value Model (GC / 1OZ / PAXG).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#111620] text-[#F1F1F1] antialiased">
        {children}
      </body>
    </html>
  );
}
