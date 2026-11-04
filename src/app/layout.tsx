import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Rest In Prompts",
  description:
    "收录有整体停止运营证据的 AI 相关公司，分别呈现关闭事实、公开来源与 AI 因果关系。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
