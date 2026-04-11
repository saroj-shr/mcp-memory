"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entriesApi, projectsApi } from "@/lib/api";
import {
  ArrowLeft, Eye, Pencil, Trash2, X, SlidersHorizontal,
  ChevronLeft, ChevronRight, FolderKanban,
} from "lucide-react";

interface Entry {
  id: string;
  content: string;
  project: string;
  tags: string[];
  type: string;
  source: string;
  created_at: string;
}

const ENTRY_TYPES = ["session", "decision", "pattern", "debug", "note"];

const TYPE_COLORS: Record<string, string> = {
  session: "#58a6ff",
  decision: "#d2a8ff",
  pattern: "#7ee787",
  debug: "#ffa657",
  note: "#79c0ff",
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectName = decodeURIComponent(params.name as string);

  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState("");
  const [filterTags, setFilterTags] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewEntry, setViewEntry] = useState<Entry | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editType, setEditType] = useState("");
  const perPage = 20;

  // Get projects list to find this project's metadata
  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data.projects),
  });

  const project = projectsData?.find((p: { name: string }) => p.name === projectName);

  const { data: allTags } = useQuery({
    queryKey: ["tags", projectName],
    queryFn: () => entriesApi.tags().then((r) => r.data.tags),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-entries", projectName, page, filterType, filterTags],
    queryFn: () =>
      entriesApi
        .list({
          project: projectName,
          entry_type: filterType || undefined,
          tags: filterTags || undefined,
          offset: (page - 1) * perPage,
          limit: perPage,
        })
        .then((r) => r.data),
  });

  const entries: Entry[] = data?.entries ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => entriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-entries", projectName] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content, tags, entry_type }: { id: string; content: string; tags: string[]; entry_type: string }) =>
      entriesApi.update(id, { content, tags, entry_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-entries", projectName] });
      setEditEntry(null);
    },
  });

  const openEdit = (entry: Entry) => {
    setEditEntry(entry);
    setEditContent(entry.content);
    setEditTags(entry.tags?.join(", ") ?? "");
    setEditType(entry.type ?? "");
  };

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    updateMutation.mutate({
      id: editEntry.id,
      content: editContent,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      entry_type: editType,
    });
  };

  const clearFilters = () => {
    setFilterType("");
    setFilterTags("");
    setPage(1);
  };

  const hasFilters = filterType || filterTags;

  // Count entries by type from current data for this project
  const typeCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-dim)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div
          className="p-2.5 rounded-lg"
          style={{ background: `${project?.color ?? "#7c6ff7"}20` }}
        >
          <FolderKanban className="w-5 h-5" style={{ color: project?.color ?? "#7c6ff7" }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{projectName}</h1>
          {project?.description && (
            <p className="text-sm text-[var(--color-dim)] mt-0.5">{project.description}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-2 mb-6">
        <div className="card !p-3 flex items-center gap-2 text-sm">
          <span className="text-[var(--color-dim)]">Total</span>
          <span className="font-bold">{total}</span>
        </div>
        {ENTRY_TYPES.filter((t) => typeCounts[t]).map((t) => (
          <button
            key={t}
            onClick={() => { setFilterType(filterType === t ? "" : t); setPage(1); }}
            className="card !p-3 flex items-center gap-2 text-sm transition-all"
            style={filterType === t ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t] } : {}}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
            <span className="text-[var(--color-dim)]">{t}</span>
            <span className="font-bold">{typeCounts[t]}</span>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary flex items-center gap-2 ${showFilters || hasFilters ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {hasFilters && <span className="ml-1 text-xs bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded-full">on</span>}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} className="btn-secondary text-xs">Clear</button>
        )}
      </div>

      {showFilters && (
        <div className="card mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Type</label>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
              className="input-field"
            >
              <option value="">All types</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Tag</label>
            <select
              value={filterTags}
              onChange={(e) => { setFilterTags(e.target.value); setPage(1); }}
              className="input-field"
            >
              <option value="">All tags</option>
              {allTags?.map((t: string) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* View Modal */}
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
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className="tag"
                  style={TYPE_COLORS[viewEntry.type] ? { borderColor: TYPE_COLORS[viewEntry.type], color: TYPE_COLORS[viewEntry.type] } : {}}
                >
                  {viewEntry.type}
                </span>
                <span className="text-[var(--color-dim)]">{viewEntry.source}</span>
                <span className="text-[var(--color-dim)]">
                  {viewEntry.created_at ? new Date(viewEntry.created_at).toLocaleString() : ""}
                </span>
              </div>
              <div>
                <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Content</label>
                <pre className="mt-2 text-sm whitespace-pre-wrap font-sans leading-relaxed bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)] overflow-x-auto">
                  {viewEntry.content}
                </pre>
              </div>
              {viewEntry.tags?.length > 0 && (
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

      {/* Edit Modal */}
      {editEntry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={submitEdit} className="card w-full max-w-2xl relative">
            <button
              type="button"
              onClick={() => setEditEntry(null)}
              className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold mb-4">Edit Entry</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="input-field min-h-[150px] resize-y"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Type</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="input-field"
                >
                  {ENTRY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">
                  Tags (comma separated)
                </label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="input-field"
                  placeholder="tag1, tag2"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="submit" className="btn-primary flex-1" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </button>
              <button type="button" onClick={() => setEditEntry(null)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Entries list */}
      {isLoading ? (
        <div className="text-[var(--color-dim)]">Loading entries…</div>
      ) : isError ? (
        <div className="card text-center py-12">
          <p className="text-[var(--color-danger)]">Failed to load entries.</p>
        </div>
      ) : entries.length ? (
        <>
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="card relative group cursor-pointer hover:border-[var(--color-accent)] transition-colors"
                onClick={() => setViewEntry(entry)}
              >
                {/* Type indicator */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                  style={{ background: TYPE_COLORS[entry.type] ?? "var(--color-border)" }}
                />
                <div className="pl-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded border"
                      style={{ color: TYPE_COLORS[entry.type], borderColor: TYPE_COLORS[entry.type] + "50", background: TYPE_COLORS[entry.type] + "15" }}
                    >
                      {entry.type}
                    </span>
                    <span className="text-xs text-[var(--color-dim)]">{entry.source}</span>
                    <span className="text-xs text-[var(--color-dim)] ml-auto">
                      {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed line-clamp-3">
                    {entry.content}
                  </p>
                  {entry.content.length > 300 && (
                    <p className="text-xs text-[var(--color-accent)] mt-1">Click to read more</p>
                  )}
                  {entry.tags?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.tags.map((t) => (
                        <span key={t} className="tag text-[10px]">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Actions — stop propagation so click doesn't open the view modal */}
                <div
                  className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setViewEntry(entry)}
                    className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-accent)]"
                    title="View"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openEdit(entry)}
                    className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-accent)]"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Delete this entry?")) deleteMutation.mutate(entry.id);
                    }}
                    className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-danger)]"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6">
            <p className="text-xs text-[var(--color-dim)]">
              Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} entries
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="btn-secondary p-2 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="flex items-center text-sm text-[var(--color-dim)]">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="btn-secondary p-2 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="card text-center py-12">
          <FolderKanban className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">
            {hasFilters ? "No entries match the current filters" : "No entries in this project yet"}
          </p>
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary mt-4 text-xs">
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
