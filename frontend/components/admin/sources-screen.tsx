"use client";

import { CircleAlertIcon, FolderSyncIcon, HistoryIcon, RefreshCwIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { DescriptionList, Page, PageHeader, Panel } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { ErrorState, ListSkeleton } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, type UploadBody } from "@/lib/api/client";
import {
  useDocumentSource,
  useGroups,
  useScans,
  useSyncDocuments,
  useUploadDocument,
} from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";

const TRIGGER: Record<string, string> = { startup: "On start", schedule: "Scheduled", manual: "Sync now" };

export function SourcesScreen() {
  const source = useDocumentSource();
  const scans = useScans();
  const sync = useSyncDocuments();
  const [uploading, setUploading] = useState(false);
  const last = scans.data?.[0];
  const minutes = source.data ? Math.round(source.data.sync_interval_s / 60) : null;

  return (
    <Page>
      <PageHeader
        title="Sources and sync"
        description="Where documents come from and how they stay current. Edits, renames, moves and deletions are picked up on every sync; a failed sync changes nothing."
        actions={
          <>
            <Button variant="outline" onClick={() => setUploading(true)}>
              <UploadIcon />
              Upload document
            </Button>
            <Button
              disabled={sync.isPending}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: (scan) => {
                    const s = scan.stats as Record<string, unknown[] | number>;
                    const n = (k: string) => (Array.isArray(s[k]) ? (s[k] as unknown[]).length : 0);
                    toast.success(
                      `Synced: ${n("created")} new, ${n("updated")} changed, ${n("renamed")} moved, ${n("missing")} removed`,
                    );
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              {sync.isPending ? <Spinner /> : <RefreshCwIcon />}
              Sync now
            </Button>
          </>
        }
      />
      <Panel icon={FolderSyncIcon} title="Shared folder">
        {source.isPending ? (
          <ListSkeleton rows={2} />
        ) : source.isError ? (
          <ErrorState error={source.error} onRetry={() => source.refetch()} />
        ) : (
          <DescriptionList
            items={[
              {
                label: "Folder",
                value: source.data.path ? (
                  <span className="break-all font-mono text-sm">{source.data.path}</span>
                ) : (
                  "Not configured"
                ),
              },
              {
                label: "Status",
                value: source.data.available ? (
                  <Badge variant="success">Available</Badge>
                ) : (
                  <Badge variant="destructive">Not found</Badge>
                ),
              },
              { label: "Manifest", value: source.data.manifest ? "manifest.csv found" : "No manifest" },
              {
                label: "Schedule",
                value: minutes
                  ? `Every ${minutes} minute${minutes === 1 ? "" : "s"}, and on every start`
                  : "On start only",
              },
              {
                label: "Last sync",
                value: last ? `${relativeTime(last.started_at)}${last.error ? " (failed)" : ""}` : "Never",
              },
              {
                label: "Uploaded in Thinq",
                value: `${source.data.uploads} document${source.data.uploads === 1 ? "" : "s"}`,
              },
            ]}
          />
        )}
      </Panel>

      <Panel icon={HistoryIcon} title="Sync history" description="The last 50 syncs.">
        {scans.isPending ? (
          <ListSkeleton />
        ) : scans.isError ? (
          <ErrorState error={scans.error} onRetry={() => scans.refetch()} />
        ) : (
          <ol className="divide-y" data-testid="scan-history">
            {scans.data.map((scan) => {
              const s = scan.stats as Record<string, unknown>;
              const count = (k: string) => (Array.isArray(s[k]) ? (s[k] as unknown[]).length : 0);
              return (
                <li key={scan.id} className="flex flex-col gap-1 px-4 py-4 text-sm md:px-6">
                  <span className="flex flex-wrap items-center gap-2">
                    {scan.error ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : (
                      <Badge variant="outline">OK</Badge>
                    )}
                    <span className="font-medium">{TRIGGER[scan.trigger ?? "manual"] ?? scan.trigger}</span>
                    <span className="text-muted-foreground text-xs">{relativeTime(scan.started_at)}</span>
                  </span>
                  {scan.error ? (
                    <span className="flex items-start gap-2 text-destructive text-sm">
                      <CircleAlertIcon className="mt-1 size-4 shrink-0" aria-hidden />
                      <span className="break-words">{scan.error}. Nothing was changed.</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {count("created")} new · {count("updated")} changed · {count("renamed")} renamed or
                      moved · {count("missing")} removed · {typeof s.unchanged === "number" ? s.unchanged : 0}{" "}
                      unchanged
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      <UploadDialog open={uploading} onOpenChange={setUploading} />
    </Page>
  );
}

const STATUSES: { value: UploadBody["status"]; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "reference", label: "Reference" },
  { value: "unknown", label: "Status unknown" },
];

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groups = useGroups();
  const upload = useUploadDocument();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState<UploadBody["status"]>("draft");
  const options = (groups.data ?? []).map((g) => ({ value: g.id, label: g.name }));
  const reset = () => {
    setFile(null);
    setTitle("");
    setOwner("");
    setGroupId("");
    setStatus("draft");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            Markdown or plain text, up to 1 MB. Uploading a file with the same name again adds a new version.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="upload-file">File</FieldLabel>
            <Input
              id="upload-file"
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return setFile(null);
                if (f.size > 1_000_000) {
                  toast.error("That file is over 1 MB.");
                  e.target.value = "";
                  return;
                }
                setFile({ name: f.name, content: await f.text() });
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-title">Title</FieldLabel>
            <Input
              id="upload-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="From the first heading if empty"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-group">Who can see it</FieldLabel>
            <SimpleSelect
              id="upload-group"
              label="Access group"
              value={groupId}
              onChange={setGroupId}
              options={[{ value: "", label: "Choose a group" }, ...options]}
              className="md:w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-owner">Owner</FieldLabel>
            <Input
              id="upload-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Person responsible for keeping it correct"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-status">Status</FieldLabel>
            <SimpleSelect
              id="upload-status"
              label="Status"
              value={status}
              onChange={setStatus}
              options={STATUSES}
              className="md:w-full"
            />
            <FieldDescription>Only Approved documents are treated as official.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file || !groupId || upload.isPending}
            onClick={() =>
              file &&
              upload.mutate(
                {
                  filename: file.name.replace(/[^\w.\- ()]/g, "_"),
                  content: file.content,
                  title: title.trim() || null,
                  access_group_id: groupId,
                  owner_name: owner.trim() || null,
                  status,
                },
                {
                  onSuccess: (doc) => {
                    toast.success(`Uploaded “${doc.title}” (version ${doc.current_version})`);
                    onOpenChange(false);
                    reset();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {upload.isPending && <Spinner />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
