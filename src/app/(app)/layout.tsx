"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  Newspaper,
  Settings,
  Upload,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/frontpage", label: "Front Page", icon: Newspaper },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6">
        <div className="mb-10 px-2 font-serif text-2xl leading-none font-medium tracking-tight">
          Finance<span className="text-brand">.</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-brand bg-sidebar-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-x-hidden px-10 py-9">{children}</main>
    </div>
  );
}
