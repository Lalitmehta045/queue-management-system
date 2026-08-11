import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Queue Management System",
  description: "Multi-tenant queue management SaaS foundation"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
