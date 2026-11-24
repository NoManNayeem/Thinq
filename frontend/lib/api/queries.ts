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
  chatConfig: ["chat", "config"] as const,
  knowledgeGraph: ["knowledge", "graph"] as const,
  approvals: ["approvals"] as const,
  history: (id: string) => ["document", id, "history"] as const,
  inbox: (state: string) => ["feedback", "inbox", state] as const,
  inboxAll: ["feedback", "inbox"] as const,
  myReports: ["feedback", "mine"] as const,
  scans: ["admin", "scans"] as const,
  quality: (days: number) => ["admin", "quality", days] as const,
  configWarnings: ["admin", "config-warnings"] as const,
  knowledgeStatus: ["admin", "knowledge"] as const,
  conversations: ["chat", "conversations"] as const,
  conversation: (id: string) => ["chat", "conversation", id] as const,
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

// ---------------------------------------------------------------- chat

export function useKnowledgeGraph() {
  return useQuery({
    queryKey: keys.knowledgeGraph,
    queryFn: () => unwrap(api.GET("/api/knowledge/graph")),
    staleTime: 60_000,
  });
}

export function useKnowledgeStatus(enabled = true) {
  return useQuery({
    queryKey: keys.knowledgeStatus,
    queryFn: () => unwrap(api.GET("/api/admin/knowledge")),
    enabled,
    refetchInterval: (q) => (q.state.data?.syncing || q.state.data?.pending ? 5_000 : false),
  });
}

export function useSyncKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/knowledge/sync")),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.knowledgeStatus });
      qc.invalidateQueries({ queryKey: keys.knowledgeGraph });
    },
  });
}

export function useChatConfig() {
  return useQuery({ queryKey: keys.chatConfig, queryFn: () => unwrap(api.GET("/api/chat/config")) });
}

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () => unwrap(api.GET("/api/chat/conversations")),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: keys.conversation(id ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/api/chat/conversations/{conversation_id}", {
          params: { path: { conversation_id: id ?? "" } },
        }),
      ),
    enabled: id !== null,
    // A thread is loaded once; afterwards the live chat state is the source of truth.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/chat/conversations", { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Schemas["ConversationUpdateIn"]) =>
      unwrap(
        api.PATCH("/api/chat/conversations/{conversation_id}", {
          params: { path: { conversation_id: id } },
          body,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE("/api/chat/conversations/{conversation_id}", {
          params: { path: { conversation_id: id } },
        }),
      ),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: keys.conversation(id) });
      qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useMessageFeedback() {
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: Schemas["FeedbackIn"] | null }) => {
      const opts = { params: { path: { message_id: messageId } } };
      return body
        ? unwrap(api.PUT("/api/chat/messages/{message_id}/feedback", { ...opts, body }))
        : unwrap(api.DELETE("/api/chat/messages/{message_id}/feedback", opts));
    },
  });
}

// ---------------------------------------------------------------- trust and approval

function invalidateTrust(qc: QueryClient, id?: string) {
  invalidateDocuments(qc, id);
  qc.invalidateQueries({ queryKey: keys.approvals });
  if (id) qc.invalidateQueries({ queryKey: keys.history(id) });
  qc.invalidateQueries({ queryKey: keys.knowledgeGraph });
}

export function useApprovals(enabled = true) {
  return useQuery({
    queryKey: keys.approvals,
    queryFn: () => unwrap(api.GET("/api/approvals")),
    enabled,
  });
}

export function useDocumentHistory(id: string) {
  return useQuery({
    queryKey: keys.history(id),
    queryFn: () =>
      unwrap(api.GET("/api/documents/{document_id}/history", { params: { path: { document_id: id } } })),
  });
}

export function useChangeStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["StatusActionIn"]) =>
      unwrap(
        api.POST("/api/documents/{document_id}/status", { params: { path: { document_id: id } }, body }),
      ),
    onSuccess: (doc) => {
      qc.setQueryData(keys.document(id), doc);
      invalidateTrust(qc, id);
    },
  });
}

export function useDecideProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; accept: boolean; note?: string | null }) =>
      unwrap(
        api.POST("/api/approvals/proposals/{proposal_id}", { params: { path: { proposal_id: id } }, body }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(keys.approvals, data);
      invalidateTrust(qc);
      qc.invalidateQueries({ queryKey: ["document"] });
    },
  });
}

// ---------------------------------------------------------------- feedback inbox

export function useInbox(state: "open" | "resolved" | "all" = "open", enabled = true) {
  return useQuery({
    queryKey: keys.inbox(state),
    queryFn: () => unwrap(api.GET("/api/feedback/inbox", { params: { query: { state } } })),
    enabled,
  });
}

export function useMyReports() {
  return useQuery({ queryKey: keys.myReports, queryFn: () => unwrap(api.GET("/api/feedback/mine")) });
}

export function useResolveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Schemas["ResolveIn"]) =>
      unwrap(api.POST("/api/feedback/items/{item_id}/resolve", { params: { path: { item_id: id } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.inboxAll });
      qc.invalidateQueries({ queryKey: keys.myReports });
      invalidateTrust(qc);
    },
  });
}

export function useReportDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["ReportDocumentIn"]) =>
      unwrap(
        api.POST("/api/documents/{document_id}/report", { params: { path: { document_id: id } }, body }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myReports });
      qc.invalidateQueries({ queryKey: keys.inboxAll });
    },
  });
}

// ---------------------------------------------------------------- sources, quality, setup

export function useScans() {
  return useQuery({ queryKey: keys.scans, queryFn: () => unwrap(api.GET("/api/admin/documents/scans")) });
}

export function useSyncDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/documents/scan")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.scans });
      qc.invalidateQueries({ queryKey: keys.latestScan });
      invalidateTrust(qc);
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UploadIn"]) => unwrap(api.POST("/api/admin/documents/upload", { body })),
    onSuccess: () => invalidateTrust(qc),
  });
}

export function useQuality(days: number) {
  return useQuery({
    queryKey: keys.quality(days),
    queryFn: () => unwrap(api.GET("/api/admin/quality", { params: { query: { days } } })),
  });
}

export function useInspect() {
  return useMutation({
    mutationFn: (body: Schemas["InspectIn"]) => unwrap(api.POST("/api/admin/retrieval/inspect", { body })),
  });
}

export function useConfigWarnings(enabled: boolean) {
  return useQuery({
    queryKey: keys.configWarnings,
    queryFn: () => unwrap(api.GET("/api/admin/config-warnings")),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useSetupStatus() {
  return useQuery({ queryKey: ["auth", "setup"], queryFn: () => unwrap(api.GET("/api/auth/setup")) });
}

export function useDocumentSource() {
  return useQuery({
    queryKey: ["admin", "source"],
    queryFn: () => unwrap(api.GET("/api/admin/documents/source")),
  });
}
