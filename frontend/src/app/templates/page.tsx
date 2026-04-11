"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { templatesApi, type Template, type TemplateCreateParams } from "@/lib/api";
import {
  Plus, Pencil, Trash2, X, Copy, Check, Search,
  BookOpen, Wand2, Terminal, Workflow, Code2, MoreHorizontal,
} from "lucide-react";

const CATEGORIES = [
  { value: "", label: "All", icon: BookOpen },
  { value: "skill",    label: "Skills",   icon: Wand2 },
  { value: "prompt",   label: "Prompts",  icon: Terminal },
  { value: "system",   label: "System",   icon: Code2 },
  { value: "workflow", label: "Workflows", icon: Workflow },
  { value: "snippet",  label: "Snippets", icon: MoreHorizontal },
  { value: "other",    label: "Other",    icon: MoreHorizontal },
];

const CATEGORY_COLORS: Record<string, string> = {
  skill:    "#d2a8ff",
  prompt:   "#7c6ff7",
  system:   "#58a6ff",
  workflow: "#7ee787",
  snippet:  "#ffa657",
  other:    "#79c0ff",
};

const emptyForm = (): TemplateCreateParams => ({
  name: "", category: "prompt", content: "",
  description: "", variables: [], tags: [],
});

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewTemplate, setViewTemplate] = useState<Template | null>(null);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TemplateCreateParams>(emptyForm());
  const [formTags, setFormTags] = useState("");
  const [formVars, setFormVars] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["templates", activeCategory, searchQuery],
    queryFn: () =>
      templatesApi
        .list(activeCategory || undefined, searchQuery || undefined)
        .then((r) => r.data.templates as Template[]),
  });

  const templates = data ?? [];

  const createMutation = useMutation({
    mutationFn: (params: TemplateCreateParams) => templatesApi.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setShowCreate(false);
      setForm(emptyForm());
      setFormTags("");
      setFormVars("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, params }: { id: number; params: Partial<TemplateCreateParams> }) =>
      templatesApi.update(id, params),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setEditTemplate(null);
      // Update viewTemplate if it's currently open
      setViewTemplate((prev) => (prev?.id === res.data.id ? res.data : prev));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => templatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setViewTemplate(null);
    },
  });

  const openCreate = () => {
    setEditTemplate(null);
    setForm(emptyForm());
    setFormTags("");
    setFormVars("");
    setShowCreate(true);
  };

  const openEdit = (t: Template) => {
    setEditTemplate(t);
    setForm({
      name: t.name,
      category: t.category,
      content: t.content,
      description: t.description,
      variables: t.variables,
      tags: t.tags,
    });
    setFormTags(t.tags.join(", "));
    setFormVars(t.variables.join(", "));
    setShowCreate(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      tags: formTags.split(",").map((s) => s.trim()).filter(Boolean),
      variables: formVars.split(",").map((s) => s.trim()).filter(Boolean),
    };
    if (editTemplate) {
      updateMutation.mutate({ id: editTemplate.id, params: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const copyContent = (t: Template) => {
    navigator.clipboard.writeText(t.content);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Templates</h1>
          <p className="text-[var(--color-dim)] text-sm">
            Store and reuse instruction templates — skills, prompts, system messages, workflows
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      {/* Category tabs + search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeCategory === cat.value
                  ? "bg-[var(--color-accent-glow)] text-[var(--color-accent)] border border-[var(--color-accent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-dim)] border border-[var(--color-border)] hover:text-[var(--color-text)]"
              }`}
            >
              {cat.label}
              {cat.value && data && (
                <span className="opacity-60">
                  {templates.filter((t) => cat.value === "" || t.category === cat.value).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-dim)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="input-field pl-9 text-sm"
          />
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleSubmit}
            className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto relative"
          >
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold mb-4">
              {editTemplate ? "Edit Template" : "New Template"}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--color-dim)] mb-1">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-field"
                    placeholder="my-template"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-dim)] mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="input-field"
                    required
                  >
                    {CATEGORIES.filter((c) => c.value).map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input-field"
                  placeholder="What does this template do?"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">
                  Content *
                  <span className="ml-2 text-[var(--color-accent)]">
                    Use {"{{variable_name}}"} for placeholders
                  </span>
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="input-field min-h-[200px] resize-y font-mono text-sm"
                  placeholder="Write your template here..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--color-dim)] mb-1">
                    Variables (comma separated)
                  </label>
                  <input
                    value={formVars}
                    onChange={(e) => setFormVars(e.target.value)}
                    className="input-field"
                    placeholder="language, framework, task"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-dim)] mb-1">
                    Tags (comma separated)
                  </label>
                  <input
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    className="input-field"
                    placeholder="coding, review, testing"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Saving..."
                  : editTemplate ? "Save Changes" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
            {(createMutation.isError || updateMutation.isError) && (
              <p className="text-xs text-[var(--color-danger)] mt-2">
                {/* @ts-expect-error axios error */}
                {(createMutation.error || updateMutation.error)?.response?.data?.detail ?? "Failed to save"}
              </p>
            )}
          </form>
        </div>
      )}

      {/* View Modal */}
      {viewTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto relative">
            <button
              onClick={() => setViewTemplate(null)}
              className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-semibold">{viewTemplate.name}</h2>
                  <span
                    className="text-xs px-2 py-0.5 rounded border"
                    style={{
                      color: CATEGORY_COLORS[viewTemplate.category] ?? "var(--color-dim)",
                      borderColor: (CATEGORY_COLORS[viewTemplate.category] ?? "#888") + "50",
                      background: (CATEGORY_COLORS[viewTemplate.category] ?? "#888") + "15",
                    }}
                  >
                    {viewTemplate.category}
                  </span>
                </div>
                {viewTemplate.description && (
                  <p className="text-sm text-[var(--color-dim)]">{viewTemplate.description}</p>
                )}
              </div>
            </div>

            {viewTemplate.variables.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Variables</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {viewTemplate.variables.map((v) => (
                    <span key={v} className="text-xs px-2 py-0.5 rounded bg-[var(--color-accent-glow)] text-[var(--color-accent)] border border-[var(--color-accent)]50 font-mono">
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Content</label>
                <button
                  onClick={() => copyContent(viewTemplate)}
                  className="flex items-center gap-1 text-xs text-[var(--color-dim)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {copiedId === viewTemplate.id ? (
                    <><Check className="w-3.5 h-3.5 text-[var(--color-success)]" /> Copied!</>
                  ) : (
                    <><Copy className="w-3.5 h-3.5" /> Copy</>
                  )}
                </button>
              </div>
              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)] overflow-x-auto">
                {viewTemplate.content}
              </pre>
            </div>

            {viewTemplate.tags.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-[var(--color-dim)] uppercase tracking-wide">Tags</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {viewTemplate.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-[var(--color-dim)] mb-4">
              Updated {new Date(viewTemplate.updated_at).toLocaleString()}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => { setViewTemplate(null); openEdit(viewTemplate); }}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete template "${viewTemplate.name}"?`))
                    deleteMutation.mutate(viewTemplate.id);
                }}
                className="btn-danger flex items-center gap-2 text-sm"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates grid */}
      {isLoading ? (
        <div className="text-[var(--color-dim)]">Loading…</div>
      ) : isError ? (
        <div className="card text-center py-12">
          <p className="text-[var(--color-danger)]">Failed to load templates.</p>
        </div>
      ) : templates.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="card group relative cursor-pointer hover:border-[var(--color-accent)] transition-colors flex flex-col"
              onClick={() => setViewTemplate(t)}
            >
              {/* Category color bar */}
              <div
                className="absolute top-0 left-0 right-0 h-0.5 rounded-t"
                style={{ background: CATEGORY_COLORS[t.category] ?? "var(--color-border)" }}
              />

              <div className="flex items-start justify-between gap-2 mt-1">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate text-sm">{t.name}</h3>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      color: CATEGORY_COLORS[t.category] ?? "var(--color-dim)",
                      background: (CATEGORY_COLORS[t.category] ?? "#888") + "15",
                    }}
                  >
                    {t.category}
                  </span>
                </div>
                {/* Quick copy button */}
                <button
                  onClick={(e) => { e.stopPropagation(); copyContent(t); }}
                  className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-accent)] flex-shrink-0"
                  title="Copy content"
                >
                  {copiedId === t.id
                    ? <Check className="w-3.5 h-3.5 text-[var(--color-success)]" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {t.description && (
                <p className="text-xs text-[var(--color-dim)] mt-2 line-clamp-2">{t.description}</p>
              )}

              <p className="text-xs text-[var(--color-dim)] mt-2 line-clamp-3 font-mono leading-relaxed flex-1">
                {t.content}
              </p>

              {(t.variables.length > 0 || t.tags.length > 0) && (
                <div className="mt-3 pt-2 border-t border-[var(--color-border)] flex flex-wrap gap-1">
                  {t.variables.slice(0, 3).map((v) => (
                    <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-glow)] text-[var(--color-accent)] font-mono">
                      {`{{${v}}}`}
                    </span>
                  ))}
                  {t.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="tag text-[10px]">{tag}</span>
                  ))}
                </div>
              )}

              {/* Actions on hover */}
              <div
                className="absolute bottom-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => openEdit(t)}
                  className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-dim)] hover:text-[var(--color-accent)]"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${t.name}"?`)) deleteMutation.mutate(t.id);
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
      ) : (
        <div className="card text-center py-16">
          <BookOpen className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">
            {searchQuery || activeCategory ? "No templates match your filter" : "No templates yet"}
          </p>
          <p className="text-xs text-[var(--color-dim)] mt-1">
            Create templates for skills, prompts, system messages and more
          </p>
          {!searchQuery && !activeCategory && (
            <button onClick={openCreate} className="btn-primary mt-4 text-sm">
              Create your first template
            </button>
          )}
        </div>
      )}
    </div>
  );
}
