import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Rest In Prompts",
  description:
    "收录被 AI 浪潮冲击而倒闭、裁员或转型的公司，每条记录都附公开来源与归因置信度。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
