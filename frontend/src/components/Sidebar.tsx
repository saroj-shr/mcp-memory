"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import {
  LayoutDashboard,
  Search,
  FolderKanban,
  FileText,
  Key,
  Settings,
  LogOut,
  Brain,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Search", icon: Search },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/entries", label: "Entries", icon: FileText },
  { href: "/keys", label: "API Keys", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col z-40">
      {/* Logo */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-[var(--color-accent)]" />
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text)]">
              Knowledge Base
            </h1>
            <p className="text-xs text-[var(--color-dim)]">MCP Memory Server</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-[var(--color-accent-glow)] text-[var(--color-accent)]"
                  : "text-[var(--color-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--color-text)]">{user?.username}</p>
            <p className="text-xs text-[var(--color-dim)]">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-[var(--color-dim)] hover:text-[var(--color-danger)] transition-colors rounded-lg hover:bg-[var(--color-surface-hover)]"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
