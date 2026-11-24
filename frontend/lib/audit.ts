import type { AuditEvent } from "@/lib/api/client";

type Describe = (e: AuditEvent) => string;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "none" : String(v));

const ACTIONS: Record<string, { label: string; describe?: Describe }> = {
  "auth.login": {
    label: "Signed in",
    describe: (e) => (e.details.method === "demo" ? "Demo sign-in" : "Password sign-in"),
  },
  "auth.login_failed": {
    label: "Failed sign-in",
    describe: () => "Incorrect email or password",
  },
  "auth.logout": { label: "Signed out" },
  "user.created": {
    label: "User created",
    describe: (e) => {
      const groups = Array.isArray(e.details.groups) ? e.details.groups.join(", ") : "";
      return `As ${str(e.details.role)}${groups ? ` in ${groups}` : ""}`;
    },
  },
  "user.updated": {
    label: "Profile updated",
    describe: (e) => Object.keys(e.details).join(", ") || "No changes",
  },
  "user.role_changed": {
    label: "Role changed",
    describe: (e) => `${str(e.details.from)} → ${str(e.details.to)}`,
  },
  "user.deactivated": {
    label: "User deactivated",
    describe: (e) => `${str(e.details.sessions_revoked ?? 0)} sessions ended`,
  },
  "user.reactivated": { label: "User reactivated" },
  "user.password_reset": { label: "Password reset by Admin" },
  "user.password_changed": { label: "Password changed" },
  "user.sessions_revoked": {
    label: "Signed out everywhere",
    describe: (e) => `${str(e.details.sessions_revoked ?? 0)} sessions ended`,
  },
  "membership.added": {
    label: "Added to group",
    describe: (e) => str(e.details.group),
  },
  "membership.removed": {
    label: "Removed from group",
    describe: (e) => str(e.details.group),
  },
  "group.created": { label: "Group created" },
  "group.updated": {
    label: "Group updated",
    describe: (e) => Object.keys(e.details).join(", "),
  },
  "group.deleted": {
    label: "Group deleted",
    describe: (e) => `${str(e.details.members_removed ?? 0)} memberships removed`,
  },
  "document.updated": {
    label: "Document details changed",
    describe: (e) => Object.keys(e.details).join(", "),
  },
  "document.access_changed": {
    label: "Document access changed",
    describe: (e) => `${str(e.details.from)} → ${str(e.details.to)}`,
  },
  "document.registered": {
    label: "Document registered",
    describe: (e) => `Shared with ${str(e.details.access_group)}`,
  },
  "document.flag_dismissed": { label: "Document flag dismissed", describe: (e) => str(e.details.note) },
  "documents.scanned": {
    label: "Sources scanned",
    describe: (e) =>
      `${str(e.details.created)} new · ${str(e.details.updated)} changed · ${str(e.details.missing)} missing`,
  },
  "chat.asked": {
    label: "Asked Thinq",
    describe: (e) => {
      const docs = Array.isArray(e.details.documents) ? e.details.documents.length : 0;
      return `${docs} source${docs === 1 ? "" : "s"}${e.details.regenerated ? " · regenerated" : ""}`;
    },
  },
  "document.status_changed": {
    label: "Document status changed",
    describe: (e) =>
      `${str(e.details.from)} → ${str(e.details.to)}${e.details.note ? ` · ${str(e.details.note)}` : ""}`,
  },
  "document.uploaded": {
    label: "Document uploaded",
    describe: (e) => `${str(e.details.file)} · shared with ${str(e.details.access_group)}`,
  },
  "document.new_version": {
    label: "New version uploaded",
    describe: (e) => `${str(e.details.file)} · version ${str(e.details.version)}`,
  },
  "documents.scan_failed": { label: "Sync failed", describe: (e) => str(e.details.error) },
  "feedback.resolved": {
    label: "Report resolved",
    describe: (e) => str(e.details.resolution).replace("_", " "),
  },
  "retrieval.inspected": {
    label: "Retrieval inspected",
    describe: () => "As another person, nothing answered",
  },
  "auth.first_admin_created": { label: "First Admin created", describe: () => "First-run setup" },
  "system.seeded": {
    label: "Initial data loaded",
    describe: (e) => `${str(e.details.users)} users from ${str(e.details.source)}`,
  },
};

export function auditLabel(action: string) {
  return ACTIONS[action]?.label ?? action;
}

export function auditDescription(event: AuditEvent) {
  return ACTIONS[event.action]?.describe?.(event) ?? "";
}

export type AuditTone = "default" | "warning" | "destructive" | "success";

export function auditTone(action: string): AuditTone {
  if (action === "auth.login_failed" || action === "user.deactivated" || action === "group.deleted")
    return "destructive";
  if (action.startsWith("membership.removed") || action === "user.role_changed") return "warning";
  if (action === "user.created" || action === "membership.added") return "success";
  return "default";
}

export const AUDIT_FILTERS = [
  { value: "all", label: "All activity" },
  { value: "auth.", label: "Sign-ins" },
  { value: "user.", label: "Users" },
  { value: "membership.", label: "Group membership" },
  { value: "group.", label: "Groups" },
  { value: "document", label: "Documents" },
  { value: "chat.", label: "Questions" },
  { value: "system.", label: "System" },
] as const;

export const AUDIT_TONE_DOT: Record<AuditTone, string> = {
  default: "bg-muted-foreground/40",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};
