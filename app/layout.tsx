import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eastlake Speech & Debate Attendance",
  description: "Shared attendance board for Eastlake Speech & Debate with a live 75% participation check.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
