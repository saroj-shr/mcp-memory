"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { entriesApi, projectsApi, type SearchParams } from "@/lib/api";
import { Search, SlidersHorizontal, X } from "lucide-react";

interface SearchResult {
  id: string;
  score: number;
  content: string;
  project: string;
  tags: string[];
  type: string;
  source: string;
  created_at: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Partial<SearchParams>>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ total_found: number } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [viewEntry, setViewEntry] = useState<SearchResult | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data.projects),
  });

  const { data: allTags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => entriesApi.tags().then((r) => r.data.tags),
  });

  const searchMutation = useMutation({
    mutationFn: (params: SearchParams) => entriesApi.search(params),
    onSuccess: (res) => {
      setResults(res.data.results);
      setSearchMeta({ total_found: res.data.total_found });
      setSearchError(null);
    },
    onError: (err: { response?: { data?: { detail?: string } }; message?: string }) => {
      setSearchError(err?.response?.data?.detail ?? err?.message ?? "Search failed");
      setResults([]);
      setSearchMeta(null);
    },
  });

  const handleSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate({
      query,
      limit: 20,
      ...filters,
    });
  };

  const scoreColor = (score: number) => {
    if (score >= 0.8) return "var(--color-success)";
    if (score >= 0.5) return "var(--color-warning)";
    return "var(--color-danger)";
  };

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Search</h1>
      <p className="text-[var(--color-dim)] text-sm mb-6">Semantic search across your knowledge base</p>

      {/* Search Bar */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-dim)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search your knowledge base..."
            className="input-field pl-10"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary flex items-center gap-2 ${showFilters ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
        <button onClick={handleSearch} className="btn-primary" disabled={searchMutation.isPending}>
          {searchMutation.isPending ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Project</label>
            <select
              value={filters.project || ""}
              onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })}
              className="input-field"
            >
              <option value="">All projects</option>
              {projects?.map((p: { name: string }) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Type</label>
            <select
              value={filters.entry_type || ""}
              onChange={(e) => setFilters({ ...filters, entry_type: e.target.value || undefined })}
              className="input-field"
            >
              <option value="">All types</option>
              {["session", "decision", "pattern", "debug", "note"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Min Score</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={filters.min_score ?? ""}
              onChange={(e) => setFilters({ ...filters, min_score: e.target.value ? parseFloat(e.target.value) : undefined })}
              className="input-field"
              placeholder="0.0"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Tags</label>
            <select
              onChange={(e) => {
                const tag = e.target.value;
                if (tag && !filters.tags?.includes(tag)) {
                  setFilters({ ...filters, tags: [...(filters.tags || []), tag] });
                }
                e.target.value = "";
              }}
              className="input-field"
            >
              <option value="">Add tag filter...</option>
              {allTags?.map((t: string) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {filters.tags && filters.tags.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {filters.tags.map((t) => (
                  <span key={t} className="tag flex items-center gap-1">
                    {t}
                    <button onClick={() => setFilters({ ...filters, tags: filters.tags?.filter((x) => x !== t) })}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Date From</label>
            <input
              type="date"
              value={filters.date_from || ""}
              onChange={(e) => setFilters({ ...filters, date_from: e.target.value || undefined })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Date To</label>
            <input
              type="date"
              value={filters.date_to || ""}
              onChange={(e) => setFilters({ ...filters, date_to: e.target.value || undefined })}
              className="input-field"
            />
          </div>
        </div>
      )}

      {/* Results */}
      {searchMeta !== null && (
        <p className="text-sm text-[var(--color-dim)] mb-4">
          Found {searchMeta.total_found} result{searchMeta.total_found !== 1 ? "s" : ""}
        </p>
      )}

      {searchError && (
        <div className="card mb-4 border-[var(--color-danger)] text-[var(--color-danger)] text-sm">
          {searchError}
        </div>
      )}

      {/* Full-content modal */}
      {viewEntry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto relative">
            <button
              onClick={() => setViewEntry(null)}
              className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold mb-4">Entry Details</h2>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="tag">{viewEntry.project}</span>
                <span className="tag">{viewEntry.type}</span>
                <span className="text-[var(--color-dim)]">{viewEntry.source}</span>
                <span className="text-[var(--color-dim)]">
                  {viewEntry.created_at ? new Date(viewEntry.created_at).toLocaleString() : ""}
                </span>
                <span
                  className="ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded"
                  style={{ color: scoreColor(viewEntry.score), background: `${scoreColor(viewEntry.score)}15` }}
                >
                  score: {viewEntry.score.toFixed(4)}
                </span>
              </div>
              <div>
                <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Content</label>
                <pre className="mt-2 text-sm whitespace-pre-wrap font-sans leading-relaxed bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)] overflow-x-auto">
                  {viewEntry.content}
                </pre>
              </div>
              {viewEntry.tags.length > 0 && (
                <div>
                  <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Tags</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {viewEntry.tags.map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-xs text-[var(--color-dim)] font-mono">ID: {viewEntry.id}</div>
            </div>
          </div>
        </div>
      )}

      {results.length > 0 ? (
        <div className="space-y-3">
          {results.map((entry) => (
            <div
              key={entry.id}
              className="card relative cursor-pointer hover:border-[var(--color-accent)] transition-colors"
              onClick={() => setViewEntry(entry)}
            >
              <div
                className="absolute top-4 right-4 text-xs font-mono font-bold px-2 py-0.5 rounded"
                style={{ color: scoreColor(entry.score), background: `${scoreColor(entry.score)}15` }}
              >
                {entry.score.toFixed(4)}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="tag">{entry.project}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-bg)] text-[var(--color-dim)] border border-[var(--color-border)]">
                  {entry.type}
                </span>
                <span className="text-xs text-[var(--color-dim)]">{entry.source}</span>
                <span className="text-xs text-[var(--color-dim)]">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {entry.content.length > 400 ? entry.content.slice(0, 400) + "…" : entry.content}
              </p>
              {entry.content.length > 400 && (
                <p className="text-xs text-[var(--color-accent)] mt-2">Click to read full content</p>
              )}
              {entry.tags.length > 0 && (
                <div className="mt-3 flex gap-1 flex-wrap">
                  {entry.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : searchMeta !== null ? (
        <div className="card text-center py-12">
          <Search className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">No results found for &ldquo;{query}&rdquo;</p>
          <p className="text-xs text-[var(--color-dim)] mt-1">Try different keywords or broaden your filters</p>
        </div>
      ) : null}
    </div>
  );
}
