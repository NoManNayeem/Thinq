"use client";

import { FileTextIcon, SaveIcon, ShieldAlertIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IconInput } from "@/components/common/inputs";
import { Callout } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type DocumentDetail, type DocumentFlag, errorMessage } from "@/lib/api/client";
import {
  useDismissFlag,
  useGroups,
  useRegisterDocument,
  useUpdateDocument,
  useUsers,
  useVersion,
} from "@/lib/api/queries";
import { dateTime } from "@/lib/format";
import { DocumentMarkdown } from "./markdown";

type OwnerChoice = { kind: "none" } | { kind: "user"; id: string } | { kind: "other"; name: string };

function initialOwner(doc: DocumentDetail): OwnerChoice {
  if (doc.owner.user_id) return { kind: "user", id: doc.owner.user_id };
  if (doc.owner.name) return { kind: "other", name: doc.owner.name };
  return { kind: "none" };
}

function ownerPayload(choice: OwnerChoice) {
  if (choice.kind === "user") return { owner_user_id: choice.id };
  if (choice.kind === "other") return { owner_name: choice.name.trim() || null, owner_user_id: null };
  return { owner_name: null, owner_user_id: null };
}

/** Shared fields for editing and registering: title, owner, access group. */
function DocumentFields({
  doc,
  title,
  setTitle,
  owner,
  setOwner,
  groupId,
  setGroupId,
  groupRequired,
}: {
  doc: DocumentDetail;
  title: string;
  setTitle: (v: string) => void;
  owner: OwnerChoice;
  setOwner: (v: OwnerChoice) => void;
  groupId: string;
  setGroupId: (v: string) => void;
  groupRequired: boolean;
}) {
  const me = useCurrentUser();
  const users = useUsers({ status: "active", limit: 200 });
  const groups = useGroups();
  const target = groups.data?.find((g) => g.id === groupId);
  const losesAccess = target && !target.is_system && !me.user.groups.some((g) => g.id === target.id);
  const widening = target?.is_system && doc.access_group?.id !== target.id;

  const ownerValue = owner.kind === "user" ? owner.id : owner.kind;
  return (
    <FieldGroup className="gap-6">
      <Field data-invalid={!title.trim()}>
        <FieldLabel htmlFor="doc-title">Title</FieldLabel>
        <IconInput
          icon={FileTextIcon}
          id="doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {!title.trim() && <FieldError>Enter a title.</FieldError>}
      </Field>

      <Field>
        <FieldLabel htmlFor="doc-owner">Owner</FieldLabel>
        <SimpleSelect
          id="doc-owner"
          label="Owner"
          className="md:w-full"
          value={ownerValue}
          onChange={(v) =>
            setOwner(
              v === "none"
                ? { kind: "none" }
                : v === "other"
                  ? { kind: "other", name: owner.kind === "other" ? owner.name : "" }
                  : { kind: "user", id: v },
            )
          }
          options={[
            { value: "none", label: "No owner" },
            ...(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.name })),
            { value: "other", label: "Someone without a Thinq account…" },
          ]}
        />
        {owner.kind === "other" && (
          <IconInput
            icon={UserIcon}
            aria-label="Owner name"
            placeholder="Full name"
            value={owner.name}
            onChange={(e) => setOwner({ kind: "other", name: e.target.value })}
          />
        )}
        <FieldDescription>
          The person who keeps this document correct and answers questions about it.
        </FieldDescription>
      </Field>

      <Field data-invalid={groupRequired && !groupId}>
        <FieldLabel htmlFor="doc-group">Access group</FieldLabel>
        {groups.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <SimpleSelect
            id="doc-group"
            label="Access group"
            className="md:w-full"
            value={groupId || "__none"}
            onChange={(v) => setGroupId(v === "__none" ? "" : v)}
            options={[
              ...(groupRequired || !doc.access_group ? [{ value: "__none", label: "Choose a group…" }] : []),
              ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        )}
        <FieldDescription>Only members of this group can see the document.</FieldDescription>
      </Field>
      {widening && (
        <Callout icon={ShieldAlertIcon} tone="warning">
          Everyone in your organization will be able to see this document.
        </Callout>
      )}
      {losesAccess && (
        <Callout icon={ShieldAlertIcon} tone="warning">
          You aren&apos;t in {target?.name}, so you won&apos;t be able to see this document after saving.
        </Callout>
      )}
    </FieldGroup>
  );
}

export function EditDocumentDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateDocument(doc.id);
  const [title, setTitle] = useState(doc.title);
  const [owner, setOwner] = useState<OwnerChoice>(initialOwner(doc));
  const [groupId, setGroupId] = useState(doc.access_group?.id ?? "");

  const reset = () => {
    setTitle(doc.title);
    setOwner(initialOwner(doc));
    setGroupId(doc.access_group?.id ?? "");
  };

  const save = () =>
    update.mutate(
      { title: title.trim(), ...ownerPayload(owner), ...(groupId ? { access_group_id: groupId } : {}) },
      {
        onSuccess: () => {
          toast.success("Document details saved");
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>Changes apply immediately and are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <DocumentFields
          doc={doc}
          title={title}
          setTitle={setTitle}
          owner={owner}
          setOwner={setOwner}
          groupId={groupId}
          setGroupId={setGroupId}
          groupRequired={false}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending || !title.trim()}>
            {update.isPending ? <Spinner /> : <SaveIcon />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterDocumentDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const register = useRegisterDocument(doc.id);
  const [title, setTitle] = useState(doc.title);
  const [owner, setOwner] = useState<OwnerChoice>({ kind: "none" });
  const [groupId, setGroupId] = useState("");

  const save = () =>
    register.mutate(
      { title: title.trim(), access_group_id: groupId, ...ownerPayload(owner) },
      {
        onSuccess: () => {
          toast.success("Document registered", { description: "Members of its group can see it now." });
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register this document</DialogTitle>
          <DialogDescription>
            Record who owns <span className="font-medium text-foreground">{doc.source_path}</span> and who may
            see it. Its status stays unknown until the owner approves it.
          </DialogDescription>
        </DialogHeader>
        <DocumentFields
          doc={doc}
          title={title}
          setTitle={setTitle}
          owner={owner}
          setOwner={setOwner}
          groupId={groupId}
          setGroupId={setGroupId}
          groupRequired
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={register.isPending || !groupId || !title.trim()}>
            {register.isPending ? <Spinner /> : <SaveIcon />}
            Register document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DismissFlagDialog({
  docId,
  flag,
  onOpenChange,
}: {
  docId: string;
  flag: DocumentFlag | null;
  onOpenChange: (open: boolean) => void;
}) {
  const dismiss = useDismissFlag(docId);
  const [note, setNote] = useState("");
  const tooShort = note.trim().length < 3;
  return (
    <Dialog
      open={flag !== null}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setNote("");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss this flag</DialogTitle>
          <DialogDescription>{flag?.message}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="dismiss-note">Why is this fine?</FieldLabel>
          <Textarea id="dismiss-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <FieldDescription>
            Saved in the audit log. The flag comes back if the problem changes.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={tooShort || dismiss.isPending}
            onClick={() =>
              flag &&
              dismiss.mutate(
                { flagId: flag.id, note: note.trim() },
                {
                  onSuccess: () => {
                    toast.success("Flag dismissed");
                    onOpenChange(false);
                    setNote("");
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {dismiss.isPending && <Spinner />}
            Dismiss flag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VersionDialog({
  docId,
  version,
  onOpenChange,
}: {
  docId: string;
  version: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useVersion(docId, version);
  return (
    <Dialog open={version !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Version {version}</DialogTitle>
          <DialogDescription>
            {query.data ? `Imported ${dateTime(query.data.created_at)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {query.data ? (
          <DocumentMarkdown content={query.data.content} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}
