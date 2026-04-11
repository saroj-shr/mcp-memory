"use client";

import { useQuery } from "@tanstack/react-query";
import { statsApi, entriesApi } from "@/lib/api";
import { FileText, FolderKanban, Tag, Activity } from "lucide-react";

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsApi.global().then((r) => r.data),
  });

  const { data: recent } = useQuery({
    queryKey: ["recent"],
    queryFn: () => entriesApi.recent(undefined, 5).then((r) => r.data),
  });

  const statCards = [
    { label: "Total Entries", value: stats?.total_entries ?? "—", icon: FileText, color: "var(--color-accent)" },
    { label: "Projects", value: stats?.total_projects ?? "—", icon: FolderKanban, color: "var(--color-success)" },
    { label: "Tags", value: stats?.total_tags ?? "—", icon: Tag, color: "var(--color-warning)" },
    { label: "Active", value: stats ? "Online" : "—", icon: Activity, color: "var(--color-success)" },
  ];

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-[var(--color-dim)] text-sm mb-8">Overview of your knowledge base</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card flex items-center gap-4">
              <div className="p-3 rounded-lg" style={{ background: `${card.color}15` }}>
                <Icon className="w-5 h-5" style={{ color: card.color }} />
              </div>
              <div>
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="text-xs text-[var(--color-dim)]">{card.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Entries</h2>
        {recent?.entries?.length ? (
          <div className="space-y-3">
            {recent.entries.map((entry: Record<string, unknown>) => (
              <div key={entry.id as string} className="p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="tag">{entry.project as string}</span>
                  <span className="text-xs text-[var(--color-dim)]">{entry.type as string}</span>
                  <span className="text-xs text-[var(--color-dim)] ml-auto">
                    {new Date(entry.created_at as string).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text)] line-clamp-2">
                  {(entry.content as string).slice(0, 200)}
                </p>
                {(entry.tags as string[])?.length > 0 && (
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {(entry.tags as string[]).map((t: string) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[var(--color-dim)] text-sm">No entries yet. Start storing memories!</p>
        )}
      </div>
    </div>
  );
}
