import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import "./globals.css";
import { ToastHost } from '@/components/ui/Toast';

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
    <html lang="vi" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <Script src="/polyfills.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
