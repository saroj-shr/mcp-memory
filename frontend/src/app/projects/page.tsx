"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, type ProjectCreateParams } from "@/lib/api";
import { Plus, Pencil, Trash2, FolderKanban, X, ChevronRight } from "lucide-react";

interface Project {
  id: number | null;
  name: string;
  description: string;
  color: string;
  icon: string;
  entry_count: number;
  last_updated: string;
  created_at: string;
}

const COLORS = [
  "#7c6ff7", "#3fb950", "#d29922", "#e5534b", "#58a6ff",
  "#f778ba", "#79c0ff", "#7ee787", "#d2a8ff", "#ffa657",
];

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectCreateParams>({
    name: "", description: "", color: "#7c6ff7", icon: "folder",
  });

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data.projects as Project[]),
  });

  const createMutation = useMutation({
    mutationFn: (params: ProjectCreateParams) => projectsApi.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowCreate(false);
      setForm({ name: "", description: "", color: "#7c6ff7", icon: "folder" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...params }: { id: number } & Partial<ProjectCreateParams>) =>
      projectsApi.update(id, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setEditProject(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => projectsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editProject?.id) {
      updateMutation.mutate({ id: editProject.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const openEdit = (p: Project) => {
    setEditProject(p);
    setForm({ name: p.name, description: p.description, color: p.color, icon: p.icon });
    setShowCreate(true);
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Projects</h1>
          <p className="text-[var(--color-dim)] text-sm">Organize your knowledge by project</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditProject(null); setForm({ name: "", description: "", color: "#7c6ff7", icon: "folder" }); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="card w-full max-w-md relative">
            <button type="button" onClick={() => { setShowCreate(false); setEditProject(null); }} className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold mb-4">
              {editProject ? "Edit Project" : "Create Project"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input-field"
                  placeholder="my-project"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input-field min-h-[80px] resize-y"
                  placeholder="What is this project about?"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-dim)] mb-1">Color</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className="w-7 h-7 rounded-full transition-transform"
                      style={{
                        background: c,
                        transform: form.color === c ? "scale(1.2)" : "scale(1)",
                        boxShadow: form.color === c ? `0 0 0 2px var(--color-bg), 0 0 0 4px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="submit" className="btn-primary flex-1">
                {editProject ? "Save Changes" : "Create"}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setEditProject(null); }} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Projects Grid */}
      {isLoading ? (
        <div className="text-[var(--color-dim)]">Loading...</div>
      ) : projects?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.name}
              className="card group relative cursor-pointer hover:border-[var(--color-accent)] transition-colors"
              onClick={() => router.push(`/projects/${encodeURIComponent(p.name)}`)}
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-lg" style={{ background: `${p.color}20` }}>
                  <FolderKanban className="w-5 h-5" style={{ color: p.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{p.name}</h3>
                  <p className="text-xs text-[var(--color-dim)] mt-0.5 line-clamp-2">
                    {p.description || "No description"}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex-shrink-0" />
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--color-border)]">
                <div className="flex gap-4 text-xs text-[var(--color-dim)]">
                  <span>{p.entry_count} entries</span>
                  {p.last_updated && <span>{new Date(p.last_updated).toLocaleDateString()}</span>}
                </div>
                {p.id && (
                  <div
                    className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-dim)] hover:text-[var(--color-accent)]">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete project "${p.name}"?`)) deleteMutation.mutate(p.id!); }}
                      className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-dim)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <FolderKanban className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">No projects yet</p>
          <p className="text-xs text-[var(--color-dim)] mt-1">Create a project to organize your knowledge</p>
        </div>
      )}
    </div>
  );
}
