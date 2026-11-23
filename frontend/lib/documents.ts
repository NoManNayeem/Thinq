import {
  ArchiveIcon,
  BadgeCheckIcon,
  BookMarkedIcon,
  CircleHelpIcon,
  CopyIcon,
  FileQuestionIcon,
  FileWarningIcon,
  GitCompareIcon,
  LockKeyholeOpenIcon,
  type LucideIcon,
  PencilLineIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserRoundXIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { DocumentStatus } from "@/lib/api/client";

type StatusMeta = {
  label: string;
  icon: LucideIcon;
  badge: "success" | "warning" | "info" | "default" | "outline";
  /** The brief's definition, shown to everyone who opens the document. */
  meaning: string;
  /** Whether people should be warned before relying on it. */
  caution: boolean;
};

export const STATUS: Record<DocumentStatus, StatusMeta> = {
  approved: {
    label: "Approved",
    icon: BadgeCheckIcon,
    badge: "success",
    meaning: "The official version. Safe to use and share.",
    caution: false,
  },
  draft: {
    label: "Draft",
    icon: PencilLineIcon,
    badge: "warning",
    meaning: "Work in progress. Not approved for use yet.",
    caution: true,
  },
  outdated: {
    label: "Outdated",
    icon: ArchiveIcon,
    badge: "default",
    meaning: "Replaced by a newer approved version. Kept only for history.",
    caution: true,
  },
  reference: {
    label: "Reference",
    icon: BookMarkedIcon,
    badge: "info",
    meaning: "Useful background, such as meeting notes. Not a policy or procedure.",
    caution: false,
  },
  unknown: {
    label: "Status unknown",
    icon: CircleHelpIcon,
    badge: "outline",
    meaning: "Nobody has recorded whether this is approved. Check with the owner before relying on it.",
    caution: true,
  },
};

export const STATUS_ORDER: DocumentStatus[] = ["approved", "draft", "reference", "outdated", "unknown"];

export type FixAction = "register" | "edit-access" | "edit-owner" | "open-original" | "dismiss";

type FlagMeta = { label: string; icon: LucideIcon; actions: FixAction[] };

export const FLAGS: Record<string, FlagMeta> = {
  unregistered: { label: "Not in the manifest", icon: FileQuestionIcon, actions: ["register"] },
  unknown_access_group: {
    label: "Unknown access group",
    icon: LockKeyholeOpenIcon,
    actions: ["edit-access"],
  },
  sensitivity_mismatch: {
    label: "Shared too widely",
    icon: ShieldAlertIcon,
    actions: ["edit-access", "dismiss"],
  },
  likely_duplicate: { label: "Likely a copy", icon: CopyIcon, actions: ["open-original", "dismiss"] },
  missing_status: { label: "No status", icon: CircleHelpIcon, actions: ["dismiss"] },
  missing_owner: { label: "No owner", icon: UserRoundXIcon, actions: ["edit-owner"] },
  owner_is_team: { label: "Owner is a team", icon: UsersRoundIcon, actions: ["edit-owner", "dismiss"] },
  ai_instruction: { label: "Instructions aimed at AI", icon: SparklesIcon, actions: ["dismiss"] },
  status_mismatch: { label: "Status disagrees", icon: GitCompareIcon, actions: ["dismiss"] },
  source_missing: { label: "File missing", icon: FileWarningIcon, actions: ["dismiss"] },
  manifest_drift: { label: "Manifest changed", icon: GitCompareIcon, actions: ["dismiss"] },
};

export function flagMeta(kind: string): FlagMeta {
  return FLAGS[kind] ?? { label: kind, icon: FileWarningIcon, actions: ["dismiss"] };
}

export const SEVERITY = {
  critical: { label: "Critical", tone: "destructive" as const },
  warning: { label: "Warning", tone: "warning" as const },
  info: { label: "Info", tone: "neutral" as const },
};

export function severityBadge(severity: keyof typeof SEVERITY): "destructive" | "warning" | "outline" {
  const tone = SEVERITY[severity].tone;
  return tone === "neutral" ? "outline" : tone;
}
