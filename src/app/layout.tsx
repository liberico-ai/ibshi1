import type { Metadata } from "next";
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && window.crypto && !window.crypto.randomUUID) {
                window.crypto.randomUUID = function() {
                  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function(c) {
                    return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
                  });
                };
              }
            `,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
