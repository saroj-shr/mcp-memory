"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authApi, statsApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Settings, Shield, Activity } from "lucide-react";

export default function SettingsPage() {
  const { user, loadUser } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      statsApi.health().then((r) => r.data),
    refetchInterval: 30000,
  });

  const passwordMutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordMsg({ type: "success", text: "Password updated successfully" });
      setCurrentPassword("");
      setNewPassword("");
    },
    onError: (err: any) => {
      setPasswordMsg({
        type: "error",
        text: err.response?.data?.detail || "Failed to change password",
      });
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-[var(--color-dim)] text-sm">Manage your account and system settings</p>
      </div>

      {/* Profile */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className="font-semibold">Profile</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="text-xs text-[var(--color-dim)]">Username</label>
            <p className="mt-0.5">{user?.username}</p>
          </div>
          <div>
            <label className="text-xs text-[var(--color-dim)]">Role</label>
            <p className="mt-0.5 capitalize">{user?.role}</p>
          </div>
          {user?.email && (
            <div>
              <label className="text-xs text-[var(--color-dim)]">Email</label>
              <p className="mt-0.5">{user.email}</p>
            </div>
          )}
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className="font-semibold">Change Password</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPasswordMsg(null);
            passwordMutation.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input-field max-w-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-dim)] mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input-field max-w-sm"
              required
              minLength={6}
            />
          </div>
          {passwordMsg && (
            <p
              className={`text-xs ${
                passwordMsg.type === "success" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
              }`}
            >
              {passwordMsg.text}
            </p>
          )}
          <button type="submit" className="btn-primary">Update Password</button>
        </form>
      </div>

      {/* System Health */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className="font-semibold">System Health</h2>
        </div>
        {health ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="text-xs text-[var(--color-dim)]">Status</label>
              <p className="mt-0.5 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health.status === "healthy" ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"
                  }`}
                />
                {health.status}
              </p>
            </div>
            <div>
              <label className="text-xs text-[var(--color-dim)]">Qdrant</label>
              <p className="mt-0.5 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health.qdrant_connected ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"
                  }`}
                />
                {health.qdrant_connected ? "Connected" : "Disconnected"}
              </p>
            </div>
            {health.collection_info && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-dim)]">Vectors</label>
                  <p className="mt-0.5">{health.collection_info.vectors_count?.toLocaleString()}</p>
                </div>
                <div>
                  <label className="text-xs text-[var(--color-dim)]">Points</label>
                  <p className="mt-0.5">{health.collection_info.points_count?.toLocaleString()}</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-dim)]">Loading health data...</p>
        )}
      </div>
    </div>
  );
}
