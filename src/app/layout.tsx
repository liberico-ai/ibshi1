import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "IBS-ERP | Heavy Industry ERP System",
  description: "IBS Heavy Industry JSC — Enterprise Resource Planning System. Quản lý dự án, sản xuất, và quy trình 32 bước.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <head>
        <Script src="/polyfills.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
