"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PublicNav() {
  const pathname = usePathname();
  return (
    <nav className="public-nav" aria-label="主要导航">
      {[
        { href: "/", label: "公司档案", active: pathname === "/" || pathname.startsWith("/company/") },
        { href: "/stats", label: "数据观察", active: pathname === "/stats" },
        { href: "/pricing", label: "定价", active: pathname === "/pricing" },
      ].map(({ href, label, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}
