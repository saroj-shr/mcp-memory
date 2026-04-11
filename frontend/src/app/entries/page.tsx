"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entriesApi, projectsApi } from "@/lib/api";
import { Trash2, Pencil, Eye, X, ChevronLeft, ChevronRight, FileText, SlidersHorizontal } from "lucide-react";

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

export default function EntriesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewEntry, setViewEntry] = useState<Entry | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editType, setEditType] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterProject, setFilterProject] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterTags, setFilterTags] = useState("");
  const perPage = 20;

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data.projects),
  });

  const { data: allTags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => entriesApi.tags().then((r) => r.data.tags),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["entries", page, filterProject, filterType, filterTags],
    queryFn: () =>
      entriesApi
        .list({
          offset: (page - 1) * perPage,
          limit: perPage,
          project: filterProject || undefined,
          entry_type: filterType || undefined,
          tags: filterTags || undefined,
        })
        .then((r) => r.data),
  });

  const entries: Entry[] = data?.entries ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => entriesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["entries"] }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => entriesApi.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      setSelected(new Set());
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content, tags, entry_type }: { id: string; content: string; tags: string[]; entry_type: string }) =>
      entriesApi.update(id, { content, tags, entry_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      setEditEntry(null);
    },
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => e.id)));
  };

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
    setFilterProject("");
    setFilterType("");
    setFilterTags("");
    setPage(1);
  };

  const hasFilters = filterProject || filterType || filterTags;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Entries</h1>
          <p className="text-[var(--color-dim)] text-sm">
            {total > 0 ? `${total} total entries` : "Manage your knowledge entries"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary flex items-center gap-2 ${showFilters || hasFilters ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {hasFilters && <span className="ml-1 text-xs bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded-full">on</span>}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => {
                if (confirm(`Delete ${selected.size} entries?`))
                  bulkDeleteMutation.mutate(Array.from(selected));
              }}
              className="btn-danger flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Delete {selected.size}
            </button>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="card mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Project</label>
            <select
              value={filterProject}
              onChange={(e) => { setFilterProject(e.target.value); setPage(1); }}
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
          {hasFilters && (
            <div className="sm:col-span-3">
              <button onClick={clearFilters} className="btn-secondary text-xs">Clear all filters</button>
            </div>
          )}
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
                <span className="tag">{viewEntry.project}</span>
                <span className="tag">{viewEntry.type}</span>
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

      {/* Table */}
      {isLoading ? (
        <div className="text-[var(--color-dim)]">Loading...</div>
      ) : isError ? (
        <div className="card text-center py-12">
          <p className="text-[var(--color-danger)]">Failed to load entries. Check your connection.</p>
        </div>
      ) : entries.length ? (
        <>
          <div className="card overflow-hidden !p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-dim)]">
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === entries.length && entries.length > 0}
                      onChange={toggleAll}
                      className="accent-[var(--color-accent)]"
                    />
                  </th>
                  <th className="p-3">Content</th>
                  <th className="p-3 w-28">Project</th>
                  <th className="p-3 w-24">Type</th>
                  <th className="p-3 w-40">Tags</th>
                  <th className="p-3 w-32">Date</th>
                  <th className="p-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                        className="accent-[var(--color-accent)]"
                      />
                    </td>
                    <td className="p-3 max-w-xs">
                      <span
                        className="truncate block cursor-pointer hover:text-[var(--color-accent)] transition-colors"
                        title="Click to view full content"
                        onClick={() => setViewEntry(entry)}
                      >
                        {entry.content}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{entry.project || "—"}</td>
                    <td className="p-3 text-xs">{entry.type || "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(entry.tags ?? []).slice(0, 3).map((t) => (
                          <span key={t} className="tag text-[10px]">{t}</span>
                        ))}
                        {(entry.tags?.length ?? 0) > 3 && (
                          <span className="text-[10px] text-[var(--color-dim)]">
                            +{entry.tags!.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-[var(--color-dim)]">
                      {entry.created_at
                        ? new Date(entry.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
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
                            if (confirm("Delete this entry?"))
                              deleteMutation.mutate(entry.id);
                          }}
                          className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-danger)]"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
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
                Page {page} / {totalPages}
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
          <FileText className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">
            {hasFilters ? "No entries match the current filters" : "No entries yet"}
          </p>
          <p className="text-xs text-[var(--color-dim)] mt-1">
            {hasFilters
              ? "Try clearing some filters"
              : "Entries will appear here as you add knowledge via MCP or the API"}
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

