import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEX Desk | Asia Value Model Gold Backtester",
  description:
    "Order-flow and volume profile replay terminal for the Gold Asia Value Model (GC / 1OZ / PAXG).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#07090e] text-[#e6ecf5] antialiased">
        {children}
      </body>
    </html>
  );
}
