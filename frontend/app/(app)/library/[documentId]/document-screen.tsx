"use client";

import {
  CalendarCheckIcon,
  CalendarIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCodeIcon,
  FileTextIcon,
  FileWarningIcon,
  FlagIcon,
  HashIcon,
  HistoryIcon,
  PencilIcon,
  ShieldCheckIcon,
  StampIcon,
  UserIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import type { Route } from "next";
import { useParams } from "next/navigation";
import { useState } from "react";
import { GroupChip } from "@/components/common/badges";
import { Callout, DescriptionList, IconTile, Page, PageHeader, Panel } from "@/components/common/page";
import { ErrorState } from "@/components/common/states";
import {
  DismissFlagDialog,
  EditDocumentDialog,
  RegisterDocumentDialog,
  VersionDialog,
} from "@/components/documents/document-dialogs";
import { DocumentMarkdown } from "@/components/documents/markdown";
import { StatusBadge } from "@/components/documents/status-badge";
import { useCurrentUser } from "@/components/shell/current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentDetail, DocumentFlag } from "@/lib/api/client";
import { useDocument, useVersions } from "@/lib/api/queries";
import { flagMeta, SEVERITY, STATUS, severityBadge } from "@/lib/documents";
import { dateTime, plural, relativeTime } from "@/lib/format";

function day(value: string | null) {
  return value ? dateTime(value).replace(/, \d\d:\d\d$/, "") : "—";
}

export function DocumentScreen() {
  const { documentId } = useParams<{ documentId: string }>();
  const doc = useDocument(documentId);
  if (doc.isPending) {
    return (
      <Page>
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-96 w-full" />
      </Page>
    );
  }
  if (doc.isError) {
    return (
      <Page>
        <ErrorState error={doc.error} onRetry={() => doc.refetch()} />
      </Page>
    );
  }
  return <DocumentView doc={doc.data} />;
}

function DocumentView({ doc }: { doc: DocumentDetail }) {
  const { user } = useCurrentUser();
  const isAdmin = user.role === "admin";
  const [dialog, setDialog] = useState<"edit" | "register" | null>(null);
  const [dismissing, setDismissing] = useState<DocumentFlag | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const status = STATUS[doc.status];
  const openFlags = (doc.flags ?? []).filter((f) => !f.resolved_at);

  return (
    <Page>
      <PageHeader
        leading={<IconTile icon={FileTextIcon} className="size-12" />}
        title={doc.title}
        description={doc.source_path}
        meta={
          <>
            <StatusBadge status={doc.status} />
            {doc.access_group ? (
              <GroupChip group={doc.access_group} />
            ) : (
              <Badge variant="destructive">No access group</Badge>
            )}
            {!doc.is_registered && <Badge variant="destructive">Unregistered</Badge>}
          </>
        }
        actions={
          isAdmin &&
          (doc.is_registered ? (
            <Button variant="outline" onClick={() => setDialog("edit")}>
              <PencilIcon />
              Edit details
            </Button>
          ) : (
            <Button onClick={() => setDialog("register")}>
              <StampIcon />
              Register document
            </Button>
          ))
        }
      />

      {status.caution && (
        <Callout icon={status.icon} tone={doc.status === "outdated" ? "neutral" : "warning"}>
          <span className="font-medium text-foreground">{status.label}.</span> {status.meaning}
        </Callout>
      )}
      {!doc.source_present && (
        <Callout icon={FileWarningIcon} tone="warning">
          <span className="font-medium text-foreground">The source file is missing.</span> This is the last
          imported copy.
        </Callout>
      )}

      {isAdmin && openFlags.length > 0 && (
        <FlagsPanel
          doc={doc}
          flags={openFlags}
          onFix={(action, flag) => {
            if (action === "register") setDialog("register");
            else if (action === "dismiss") setDismissing(flag);
            else setDialog("edit");
          }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article
          className="min-w-0 rounded-xl border bg-card p-6 shadow-xs md:p-8"
          aria-label="Document text"
        >
          <DocumentMarkdown content={doc.content} />
        </article>
        <div className="flex min-w-0 flex-col gap-6">
          <Panel icon={ShieldCheckIcon} title="Trust">
            <DescriptionList
              compact
              items={[
                { label: "Status", icon: status.icon, value: <StatusBadge status={doc.status} /> },
                {
                  label: "Owner",
                  icon: UserIcon,
                  value: doc.owner.name ? (
                    <span className="flex flex-col items-end">
                      {doc.owner.name}
                      {!doc.owner.has_account && (
                        <span className="text-muted-foreground text-xs">No Thinq account</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  ),
                },
                { label: "Last reviewed", icon: CalendarCheckIcon, value: day(doc.last_reviewed) },
                { label: "Last changed", icon: CalendarIcon, value: day(doc.last_modified) },
              ]}
            />
          </Panel>
          <Panel icon={EyeIcon} title="Who can see this">
            <div className="flex flex-col gap-2 p-4 text-sm md:p-6" data-testid="audience">
              {doc.access_group ? (
                <>
                  <GroupChip group={doc.access_group} />
                  <p className="text-muted-foreground">
                    {doc.access_group.is_system
                      ? "Everyone in your organization."
                      : `Only members of ${doc.access_group.name}.`}{" "}
                    {plural(doc.audience_count, "person", "people")} in total.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Only Admins, until an access group is assigned (
                  {plural(doc.audience_count, "person", "people")}).
                </p>
              )}
            </div>
          </Panel>
          <Panel icon={FileCodeIcon} title="Source">
            <DescriptionList
              compact
              items={[
                {
                  label: "File",
                  icon: FileTextIcon,
                  value: <span className="break-all">{doc.source_path}</span>,
                },
                { label: "Document ID", icon: HashIcon, value: doc.external_id ?? "—" },
              ]}
            />
          </Panel>
          <VersionsPanel doc={doc} onView={setViewing} />
        </div>
      </div>

      {isAdmin && (
        <>
          <EditDocumentDialog
            doc={doc}
            open={dialog === "edit"}
            onOpenChange={(o) => setDialog(o ? "edit" : null)}
          />
          {!doc.is_registered && (
            <RegisterDocumentDialog
              doc={doc}
              open={dialog === "register"}
              onOpenChange={(o) => setDialog(o ? "register" : null)}
            />
          )}
          <DismissFlagDialog
            docId={doc.id}
            flag={dismissing}
            onOpenChange={(o) => !o && setDismissing(null)}
          />
        </>
      )}
      <VersionDialog docId={doc.id} version={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </Page>
  );
}

function FlagDetails({ flag }: { flag: DocumentFlag }) {
  const d = flag.details as Record<string, unknown>;
  if (flag.kind === "ai_instruction" && Array.isArray(d.lines)) {
    return (
      <ul className="flex flex-col gap-1">
        {(d.lines as string[]).map((line) => (
          <li key={line} className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {line}
          </li>
        ))}
      </ul>
    );
  }
  if (flag.kind === "manifest_drift" && d.fields && typeof d.fields === "object") {
    return (
      <ul className="flex flex-col gap-1 text-xs">
        {Object.entries(d.fields as Record<string, { manifest: unknown; thinq: unknown }>).map(
          ([field, v]) => (
            <li key={field}>
              <span className="font-medium">{field.replace("_", " ")}</span>: manifest says “
              {String(v.manifest ?? "—")}”, Thinq has “{String(v.thinq ?? "—")}”
            </li>
          ),
        )}
      </ul>
    );
  }
  return null;
}

function FlagsPanel({
  doc,
  flags,
  onFix,
}: {
  doc: DocumentDetail;
  flags: DocumentFlag[];
  onFix: (action: "register" | "edit" | "dismiss", flag: DocumentFlag) => void;
}) {
  return (
    <Panel
      icon={FlagIcon}
      title={`Needs attention · ${flags.length}`}
      description="Only Admins see these. Fixing the cause resolves a flag automatically."
    >
      <ul className="divide-y" data-testid="document-flags">
        {flags.map((flag) => {
          const meta = flagMeta(flag.kind);
          const severity = SEVERITY[flag.severity];
          const original = (flag.details as { of_document_id?: string }).of_document_id;
          return (
            <li
              key={flag.id}
              className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-start md:px-6"
              data-kind={flag.kind}
            >
              <IconTile icon={meta.icon} tone={severity.tone} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{meta.label}</span>
                  <Badge variant={severityBadge(flag.severity)}>{severity.label}</Badge>
                </p>
                <p className="text-muted-foreground text-sm">{flag.message}</p>
                <FlagDetails flag={flag} />
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {meta.actions.map((action) => {
                  if (action === "open-original") {
                    return original ? (
                      <ButtonLink
                        href={`/library/${original}` as Route}
                        key={action}
                        variant="outline"
                        size="sm"
                      >
                        <ExternalLinkIcon />
                        Open original
                      </ButtonLink>
                    ) : null;
                  }
                  if (action === "register") {
                    return doc.is_registered ? null : (
                      <Button
                        key={action}
                        variant="outline"
                        size="sm"
                        onClick={() => onFix("register", flag)}
                      >
                        <StampIcon />
                        Register
                      </Button>
                    );
                  }
                  if (action === "dismiss") {
                    return (
                      <Button key={action} variant="ghost" size="sm" onClick={() => onFix("dismiss", flag)}>
                        <XIcon />
                        Dismiss
                      </Button>
                    );
                  }
                  return (
                    <Button key={action} variant="outline" size="sm" onClick={() => onFix("edit", flag)}>
                      {action === "edit-owner" ? <UserIcon /> : <UsersRoundIcon />}
                      {action === "edit-owner" ? "Assign owner" : "Set access group"}
                    </Button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function VersionsPanel({ doc, onView }: { doc: DocumentDetail; onView: (v: number) => void }) {
  const versions = useVersions(doc.id);
  return (
    <Panel icon={HistoryIcon} title="Version history">
      {versions.isPending ? (
        <div className="p-6">
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <ul className="divide-y">
          {(versions.data ?? []).map((v) => (
            <li key={v.version} className="flex items-center justify-between gap-4 px-4 py-2 md:px-6">
              <span className="flex flex-col">
                <span className="font-medium text-sm">
                  Version {v.version}{" "}
                  {v.is_current && <span className="font-normal text-muted-foreground">(current)</span>}
                </span>
                <span className="text-muted-foreground text-xs">{relativeTime(v.created_at)}</span>
              </span>
              {!v.is_current && (
                <Button variant="ghost" size="sm" onClick={() => onView(v.version)}>
                  View
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
