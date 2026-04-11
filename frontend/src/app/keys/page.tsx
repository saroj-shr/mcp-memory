"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { keysApi, type CreateKeyParams } from "@/lib/api";
import { Plus, Trash2, Key, Copy, Check, X } from "lucide-react";

const AVAILABLE_SCOPES = ["read", "write", "admin"];

export default function APIKeysPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState("");
  const [form, setForm] = useState<CreateKeyParams>({
    name: "",
    scopes: ["read", "write"],
  });

  const { data: keys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => keysApi.list().then((r) => r.data.keys),
  });

  const createMutation = useMutation({
    mutationFn: (params: CreateKeyParams) => keysApi.create(params),
    onSuccess: (res) => {
      setNewKeyValue(res.data.key);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => keysApi.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const params: CreateKeyParams = { ...form };
    if (expiryDays) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(expiryDays));
      params.expires_at = d.toISOString();
    }
    createMutation.mutate(params);
  };

  const toggleScope = (scope: string) => {
    const current = form.scopes ?? [];
    const scopes = current.includes(scope)
      ? current.filter((s) => s !== scope)
      : [...current, scope];
    setForm({ ...form, scopes });
  };

  const copyKey = async () => {
    if (newKeyValue) {
      await navigator.clipboard.writeText(newKeyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeCreateModal = () => {
    setShowCreate(false);
    setNewKeyValue(null);
    setExpiryDays("");
    setForm({ name: "", scopes: ["read", "write"] });
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">API Keys</h1>
          <p className="text-[var(--color-dim)] text-sm">Manage machine access to your knowledge base</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Generate Key
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md relative">
            <button
              onClick={closeCreateModal}
              className="absolute top-4 right-4 text-[var(--color-dim)] hover:text-[var(--color-text)]"
            >
              <X className="w-5 h-5" />
            </button>

            {newKeyValue ? (
              <>
                <h2 className="text-lg font-semibold mb-2">Key Created</h2>
                <p className="text-xs text-[var(--color-warning)] mb-4">
                  Copy this key now — it won&apos;t be shown again.
                </p>
                <div className="flex items-center gap-2 bg-[var(--color-bg)] rounded-lg p-3 border border-[var(--color-border)]">
                  <code className="flex-1 text-xs break-all select-all">{newKeyValue}</code>
                  <button onClick={copyKey} className="p-2 hover:bg-[var(--color-surface-hover)] rounded">
                    {copied ? (
                      <Check className="w-4 h-4 text-[var(--color-success)]" />
                    ) : (
                      <Copy className="w-4 h-4 text-[var(--color-dim)]" />
                    )}
                  </button>
                </div>
                <button onClick={closeCreateModal} className="btn-primary w-full mt-4">
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={handleCreate}>
                <h2 className="text-lg font-semibold mb-4">Generate API Key</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-[var(--color-dim)] mb-1">Name</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="input-field"
                      placeholder="e.g. Claude Desktop"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-dim)] mb-1">Scopes</label>
                    <div className="flex gap-2">
                      {AVAILABLE_SCOPES.map((scope) => (
                        <button
                          key={scope}
                          type="button"
                          onClick={() => toggleScope(scope)}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            form.scopes?.includes(scope)
                              ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                              : "border-[var(--color-border)] text-[var(--color-dim)] hover:border-[var(--color-accent)]"
                          }`}
                        >
                          {scope}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-dim)] mb-1">
                      Expiration (days, leave empty for no expiry)
                    </label>
                    <input
                      type="number"
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(e.target.value)}
                      className="input-field"
                      placeholder="No expiration"
                      min={1}
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-6">
                  <button type="submit" className="btn-primary flex-1">Generate</button>
                  <button type="button" onClick={closeCreateModal} className="btn-secondary">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Keys List */}
      {isLoading ? (
        <div className="text-[var(--color-dim)]">Loading...</div>
      ) : keys?.length ? (
        <div className="space-y-3">
          {keys.map((key: any) => (
            <div
              key={key.id}
              className={`card flex items-center gap-4 ${key.revoked ? "opacity-50" : ""}`}
            >
              <div className="p-2.5 rounded-lg bg-[var(--color-accent)]/10">
                <Key className="w-5 h-5 text-[var(--color-accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{key.name}</h3>
                  <code className="text-xs text-[var(--color-dim)]">{key.key_prefix}...</code>
                  {key.revoked && (
                    <span className="text-xs bg-[var(--color-danger)]/20 text-[var(--color-danger)] px-2 py-0.5 rounded">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-dim)]">
                  <span>Scopes: {key.scopes?.join(", ") ?? "—"}</span>
                  {key.expires_at && (
                    <span>Expires: {new Date(key.expires_at).toLocaleDateString()}</span>
                  )}
                  {key.last_used_at && (
                    <span>Last used: {new Date(key.last_used_at).toLocaleDateString()}</span>
                  )}
                  <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              {!key.revoked && (
                <button
                  onClick={() => {
                    if (confirm(`Revoke key "${key.name}"?`))
                      revokeMutation.mutate(key.id);
                  }}
                  className="btn-danger text-xs flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Key className="w-12 h-12 text-[var(--color-dim)] mx-auto mb-4" />
          <p className="text-[var(--color-dim)]">No API keys yet</p>
          <p className="text-xs text-[var(--color-dim)] mt-1">
            Generate a key to access the API programmatically
          </p>
        </div>
      )}
    </div>
  );
}
