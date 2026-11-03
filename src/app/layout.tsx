import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Shutdown Tracker",
  description: "有据可查的 AI 项目关停记录追踪",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
