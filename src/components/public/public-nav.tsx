"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PublicNav() {
  const pathname = usePathname();
  return (
    <nav className="public-nav" aria-label="主要导航">
      {[
        { href: "/", label: "停运公司", active: pathname === "/" || pathname.startsWith("/shutdown/") },
        { href: "/impact", label: "影响事件", active: pathname === "/impact" || pathname.startsWith("/company/") },
        { href: "/stats", label: "事件统计", active: pathname === "/stats" },
      ].map(({ href, label, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}
