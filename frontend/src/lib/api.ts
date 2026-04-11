import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Inject JWT token into requests
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const res = await axios.post(
            `${API_BASE}/api/auth/refresh`,
            {},
            { headers: { Authorization: `Bearer ${refreshToken}` } }
          );
          const newToken = res.data.access_token;
          localStorage.setItem("access_token", newToken);
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        } catch {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
        }
      } else {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──
export const authApi = {
  login: (username: string, password: string) =>
    api.post("/api/auth/login", { username, password }),
  register: (username: string, email: string, password: string) =>
    api.post("/api/auth/register", { username, email, password }),
  me: () => api.get("/api/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    api.put("/api/auth/password", { current_password, new_password }),
  getUsers: () => api.get("/api/auth/users"),
  createUser: (username: string, email: string, password: string) =>
    api.post("/api/auth/users", { username, email, password }),
};

// ── Entries ──
export interface SearchParams {
  query: string;
  project?: string;
  entry_type?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  min_score?: number;
  limit?: number;
}

export interface StoreParams {
  content: string;
  project?: string;
  tags?: string[];
  entry_type?: string;
  source?: string;
}

export interface UpdateEntryParams {
  content?: string;
  project?: string;
  tags?: string[];
  entry_type?: string;
}

export interface ListEntriesParams {
  project?: string;
  entry_type?: string;
  tags?: string;
  offset?: number;
  limit?: number;
}

export const entriesApi = {
  search: (params: SearchParams) => api.post("/api/search", params),
  list: (params: ListEntriesParams = {}) => api.get("/api/entries", { params }),
  store: (params: StoreParams) => api.post("/api/store", params),
  get: (id: string) => api.get(`/api/entries/${id}`),
  update: (id: string, params: UpdateEntryParams) =>
    api.put(`/api/entries/${id}`, params),
  delete: (id: string) => api.delete(`/api/entries/${id}`),
  bulkDelete: (ids: string[]) => api.post("/api/entries/bulk-delete", { ids }),
  export: (project?: string, entryType?: string) =>
    api.post(`/api/entries/export?${new URLSearchParams(
      Object.entries({ project, entry_type: entryType })
        .filter(([, v]) => v)
        .map(([k, v]) => [k, v!])
    ).toString()}`),
  import: (entries: StoreParams[]) =>
    api.post("/api/entries/import", { entries }),
  recent: (project?: string, limit = 10) =>
    api.get("/api/recent", { params: { project, limit } }),
  tags: () => api.get("/api/tags"),
};

// ── Projects ──
export interface ProjectCreateParams {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export const projectsApi = {
  list: () => api.get("/api/projects"),
  create: (params: ProjectCreateParams) => api.post("/api/projects", params),
  get: (id: number) => api.get(`/api/projects/${id}`),
  update: (id: number, params: Partial<ProjectCreateParams>) =>
    api.put(`/api/projects/${id}`, params),
  delete: (id: number) => api.delete(`/api/projects/${id}`),
  stats: (id: number) => api.get(`/api/projects/${id}/stats`),
};

// ── API Keys ──
export interface CreateKeyParams {
  name: string;
  scopes?: string[];
  expires_at?: string;
}

export const keysApi = {
  list: () => api.get("/api/keys"),
  create: (params: CreateKeyParams) => api.post("/api/keys", params),
  revoke: (id: number) => api.delete(`/api/keys/${id}`),
  update: (id: number, params: Partial<CreateKeyParams>) =>
    api.put(`/api/keys/${id}`, params),
};

// ── Stats ──
export const statsApi = {
  global: () => api.get("/api/stats"),
  health: () => api.get("/health"),
};

export default api;
