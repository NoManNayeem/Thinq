"use client";

import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, api, type DocumentStatus, type Me, type Schemas, unwrap } from "./client";

export const keys = {
  me: ["me"] as const,
  authConfig: ["auth", "config"] as const,
  demoUsers: ["auth", "demo-users"] as const,
  health: ["health"] as const,
  users: (params: UserListParams) => ["admin", "users", params] as const,
  usersAll: ["admin", "users"] as const,
  user: (id: string) => ["admin", "user", id] as const,
  groups: ["admin", "groups"] as const,
  group: (id: string) => ["admin", "group", id] as const,
  audit: (params: AuditParams) => ["admin", "audit", params] as const,
  auditAll: ["admin", "audit"] as const,
  documents: (params: DocumentListParams) => ["documents", params] as const,
  documentsAll: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  versions: (id: string) => ["document", id, "versions"] as const,
  version: (id: string, n: number) => ["document", id, "versions", n] as const,
  attention: ["admin", "attention"] as const,
  latestScan: ["admin", "scan"] as const,
};

// ---------------------------------------------------------------- auth

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => unwrap(api.GET("/api/auth/me")),
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    staleTime: 30_000,
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: keys.authConfig,
    queryFn: () => unwrap(api.GET("/api/auth/config")),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useDemoUsers(enabled: boolean) {
  return useQuery({
    queryKey: keys.demoUsers,
    queryFn: () => unwrap(api.GET("/api/auth/demo-users")),
    enabled,
  });
}

function onSignedIn(qc: QueryClient, me: Me) {
  qc.clear();
  qc.setQueryData(keys.me, me);
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["LoginIn"]) => unwrap(api.POST("/api/auth/login", { body })),
    onSuccess: (me) => onSignedIn(qc, me),
  });
}

export function useDemoLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => unwrap(api.POST("/api/auth/demo-login", { body: { user_id: userId } })),
    onSuccess: (me) => onSignedIn(qc, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/auth/logout")),
    onSettled: () => qc.clear(),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: Schemas["PasswordChangeIn"]) => unwrap(api.POST("/api/auth/me/password", { body })),
  });
}

// ---------------------------------------------------------------- system

export function useHealth(refetchInterval = 5_000) {
  return useQuery({
    queryKey: keys.health,
    queryFn: async () => {
      // A 503 still carries a full health report, so read the body either way.
      const res = await fetch("/api/health", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as Schemas["HealthOut"] | null;
      if (body && "database" in body) return { reachable: true as const, report: body };
      return { reachable: false as const, status: res.status };
    },
    refetchInterval,
    retry: false,
  });
}

// ---------------------------------------------------------------- admin: users

export type UserListParams = {
  q?: string;
  role?: "member" | "admin";
  status?: "active" | "inactive" | "all";
  group_id?: string;
  limit?: number;
  offset?: number;
};

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: keys.users(params),
    queryFn: () => unwrap(api.GET("/api/admin/users", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: keys.user(id),
    queryFn: () =>
      unwrap(
        api.GET("/api/admin/users/{user_id}", {
          params: { path: { user_id: id } },
        }),
      ),
  });
}

function invalidateAdmin(qc: QueryClient, userId?: string) {
  qc.invalidateQueries({ queryKey: keys.usersAll });
  qc.invalidateQueries({ queryKey: keys.groups });
  qc.invalidateQueries({ queryKey: ["admin", "group"] });
  qc.invalidateQueries({ queryKey: keys.auditAll });
  if (userId) qc.invalidateQueries({ queryKey: keys.user(userId) });
  // The signed-in admin may have changed their own groups or profile.
  qc.invalidateQueries({ queryKey: keys.me });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UserCreateIn"]) => unwrap(api.POST("/api/admin/users", { body })),
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UserUpdateIn"]) =>
      unwrap(
        api.PATCH("/api/admin/users/{user_id}", {
          params: { path: { user_id: id } },
          body,
        }),
      ),
    onSuccess: (user) => {
      qc.setQueryData(keys.user(id), user);
      invalidateAdmin(qc, id);
    },
  });
}

export function useSetPassword(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (newPassword: string) =>
      unwrap(
        api.PUT("/api/admin/users/{user_id}/password", {
          params: { path: { user_id: id } },
          body: { new_password: newPassword },
        }),
      ),
    onSuccess: () => invalidateAdmin(qc, id),
  });
}

export function useRevokeSessions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/admin/users/{user_id}/sessions/revoke", {
          params: { path: { user_id: id } },
        }),
      ),
    onSuccess: (user) => {
      qc.setQueryData(keys.user(id), user);
      invalidateAdmin(qc, id);
    },
  });
}

export function useMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      groupId,
      action,
    }: {
      userId: string;
      groupId: string;
      action: "add" | "remove";
    }) => {
      const opts = { params: { path: { user_id: userId, group_id: groupId } } };
      return unwrap(
        action === "add"
          ? api.PUT("/api/admin/users/{user_id}/groups/{group_id}", opts)
          : api.DELETE("/api/admin/users/{user_id}/groups/{group_id}", opts),
      );
    },
    onSuccess: (_, { userId }) => invalidateAdmin(qc, userId),
  });
}

// ---------------------------------------------------------------- admin: groups

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: keys.groups,
    queryFn: () => unwrap(api.GET("/api/admin/groups")),
    enabled,
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: keys.group(id),
    queryFn: () =>
      unwrap(
        api.GET("/api/admin/groups/{group_id}", {
          params: { path: { group_id: id } },
        }),
      ),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["GroupCreateIn"]) => unwrap(api.POST("/api/admin/groups", { body })),
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["GroupUpdateIn"]) =>
      unwrap(
        api.PATCH("/api/admin/groups/{group_id}", {
          params: { path: { group_id: id } },
          body,
        }),
      ),
    onSuccess: (group) => {
      qc.setQueryData(keys.group(id), group);
      invalidateAdmin(qc);
    },
  });
}

export function useDeleteGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/admin/groups/{group_id}", {
          params: { path: { group_id: id } },
        }),
      ),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.group(id) });
      invalidateAdmin(qc);
    },
  });
}

// ---------------------------------------------------------------- admin: audit

export type AuditParams = {
  action?: string;
  target_id?: string;
  limit?: number;
};

export function useAudit(params: AuditParams, enabled = true) {
  return useQuery({
    queryKey: keys.audit(params),
    queryFn: () => unwrap(api.GET("/api/admin/audit", { params: { query: params } })),
    enabled,
  });
}

export async function fetchAuditPage(params: AuditParams & { before?: number }) {
  return unwrap(api.GET("/api/admin/audit", { params: { query: params } }));
}

// ---------------------------------------------------------------- documents

export type DocumentListParams = {
  q?: string;
  status?: DocumentStatus;
  group_id?: string;
  limit?: number;
};

export function useDocuments(params: DocumentListParams) {
  return useQuery({
    queryKey: keys.documents(params),
    queryFn: () => unwrap(api.GET("/api/documents", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: keys.document(id),
    queryFn: () => unwrap(api.GET("/api/documents/{document_id}", { params: { path: { document_id: id } } })),
  });
}

export function useVersions(id: string) {
  return useQuery({
    queryKey: keys.versions(id),
    queryFn: () =>
      unwrap(api.GET("/api/documents/{document_id}/versions", { params: { path: { document_id: id } } })),
  });
}

export function useVersion(id: string, version: number | null) {
  return useQuery({
    queryKey: keys.version(id, version ?? 0),
    queryFn: () =>
      unwrap(
        api.GET("/api/documents/{document_id}/versions/{version}", {
          params: { path: { document_id: id, version: version ?? 0 } },
        }),
      ),
    enabled: version !== null,
  });
}

export function useAttention(enabled = true) {
  return useQuery({
    queryKey: keys.attention,
    queryFn: () => unwrap(api.GET("/api/admin/documents/attention")),
    enabled,
  });
}

export function useLatestScan() {
  return useQuery({
    queryKey: keys.latestScan,
    queryFn: () => unwrap(api.GET("/api/admin/documents/scans/latest")),
  });
}

function invalidateDocuments(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: keys.documentsAll });
  qc.invalidateQueries({ queryKey: keys.attention });
  qc.invalidateQueries({ queryKey: keys.latestScan });
  qc.invalidateQueries({ queryKey: keys.auditAll });
  if (id) qc.invalidateQueries({ queryKey: ["document", id] });
}

export function useUpdateDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["DocumentUpdateIn"]) =>
      unwrap(
        api.PATCH("/api/admin/documents/{document_id}", { params: { path: { document_id: id } }, body }),
      ),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      invalidateDocuments(qc, id);
    },
  });
}

export function useRegisterDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["DocumentRegisterIn"]) =>
      unwrap(
        api.POST("/api/admin/documents/{document_id}/register", {
          params: { path: { document_id: id } },
          body,
        }),
      ),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      invalidateDocuments(qc, id);
    },
  });
}

export function useDismissFlag(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, note }: { flagId: number; note: string }) =>
      unwrap(
        api.POST("/api/admin/documents/{document_id}/flags/{flag_id}/dismiss", {
          params: { path: { document_id: id, flag_id: flagId } },
          body: { note },
        }),
      ),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      invalidateDocuments(qc, id);
    },
  });
}

export function useScanDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/documents/scan")),
    onSuccess: () => invalidateDocuments(qc),
  });
}
