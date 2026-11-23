"use client";

import { SearchIcon, UserPlusIcon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CheckRow } from "@/components/common/choice";
import { IconInput } from "@/components/common/inputs";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, type GroupDetail, type UserDetail } from "@/lib/api/client";
import { useGroups, useMembership, useUsers } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { toastWithUndo } from "@/lib/undo";

type Change = { userId: string; groupId: string };

function useBulkMembership() {
  const membership = useMembership();
  const [pending, setPending] = useState(false);
  const run = async (changes: Change[], action: "add" | "remove") => {
    setPending(true);
    try {
      for (const c of changes) await membership.mutateAsync({ ...c, action });
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

export function AddToGroupsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useGroups(open);
  const bulk = useBulkMembership();
  const [selected, setSelected] = useState<string[]>([]);
  const memberOf = new Set(user.groups.map((g) => g.id));
  const available = (groups.data ?? []).filter((g) => !g.is_system && !memberOf.has(g.id));

  const close = () => {
    onOpenChange(false);
    setSelected([]);
  };

  const save = async () => {
    const chosen = available.filter((g) => selected.includes(g.id));
    const changes = chosen.map((g) => ({ userId: user.id, groupId: g.id }));
    try {
      await bulk.run(changes, "add");
      close();
      toastWithUndo({
        message: `${user.name} added to ${chosen.map((g) => g.name).join(", ")}`,
        description: "This applies to their very next request.",
        undo: () => bulk.run(changes, "remove"),
        undoneMessage: "Change undone",
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {user.name} to groups</DialogTitle>
          <DialogDescription>
            They&apos;ll see everything shared with the groups you choose.
          </DialogDescription>
        </DialogHeader>
        {groups.isPending ? (
          <Spinner className="mx-auto" />
        ) : available.length === 0 ? (
          <p className="text-muted-foreground text-sm">They&apos;re already in every group.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {available.map((g) => (
              <CheckRow
                key={g.id}
                id={`atg-${g.id}`}
                checked={selected.includes(g.id)}
                onChange={(c) => setSelected((s) => (c ? [...s, g.id] : s.filter((id) => id !== g.id)))}
                leading={<UsersRoundIcon className="size-5 text-muted-foreground" aria-hidden />}
                title={g.name}
                description={g.description ?? plural(g.member_count, "member")}
              />
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={selected.length === 0 || bulk.pending}>
            {bulk.pending ? <Spinner /> : <UserPlusIcon />}
            {selected.length > 1 ? `Add to ${selected.length} groups` : "Add to group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddPeopleDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const users = useUsers({ status: "active", limit: 200 });
  const bulk = useBulkMembership();
  const [selected, setSelected] = useState<string[]>([]);
  const inGroup = new Set(group.members.map((m) => m.id));
  const candidates = (users.data?.items ?? []).filter((u) => !inGroup.has(u.id));
  const needle = q.trim().toLocaleLowerCase();
  const shown = needle
    ? candidates.filter((u) => `${u.name} ${u.email} ${u.title ?? ""}`.toLocaleLowerCase().includes(needle))
    : candidates;

  const close = () => {
    onOpenChange(false);
    setSelected([]);
    setQ("");
  };

  const save = async () => {
    const chosen = candidates.filter((u) => selected.includes(u.id));
    const changes = chosen.map((u) => ({ userId: u.id, groupId: group.id }));
    try {
      await bulk.run(changes, "add");
      close();
      toastWithUndo({
        message: `${plural(chosen.length, "person", "people")} added to ${group.name}`,
        description: "This applies to their very next request.",
        undo: () => bulk.run(changes, "remove"),
        undoneMessage: "Change undone",
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add people to {group.name}</DialogTitle>
          <DialogDescription>They&apos;ll see everything shared with this group.</DialogDescription>
        </DialogHeader>
        <IconInput
          icon={SearchIcon}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
        {users.isPending ? (
          <Spinner className="mx-auto" />
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {candidates.length === 0 ? "Everyone is already in this group." : "No one matches that search."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((u) => (
              <CheckRow
                key={u.id}
                id={`ap-${u.id}`}
                checked={selected.includes(u.id)}
                onChange={(c) => setSelected((s) => (c ? [...s, u.id] : s.filter((id) => id !== u.id)))}
                leading={<UserAvatar name={u.name} size="sm" />}
                title={u.name}
                description={u.title ? `${u.title} · ${u.email}` : u.email}
              />
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={selected.length === 0 || bulk.pending}>
            {bulk.pending ? <Spinner /> : <UserPlusIcon />}
            {selected.length > 0 ? `Add ${plural(selected.length, "person", "people")}` : "Add people"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
