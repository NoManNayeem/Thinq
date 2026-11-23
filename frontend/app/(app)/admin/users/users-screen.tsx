"use client";

import {
  ChevronRightIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AddUserWizard } from "@/components/admin/add-user-wizard";
import { GroupChips, RoleBadge, UserStatus } from "@/components/common/badges";
import { FilterTabs } from "@/components/common/filter-tabs";
import { IconInput } from "@/components/common/inputs";
import { Page, PageHeader } from "@/components/common/page";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { useCurrentUser } from "@/components/shell/current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import type { User } from "@/lib/api/client";
import { type UserListParams, useGroups, useUsers } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";

const PAGE_SIZE = 25;
type Status = "active" | "inactive" | "all";
type RoleFilter = "all" | "member" | "admin";

export function UsersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { user: me } = useCurrentUser();
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [role, setRole] = useState<RoleFilter>("all");
  const [groupId, setGroupId] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const query = useDebounced(q.trim());
  const groups = useGroups();

  const listParams: UserListParams = {
    q: query || undefined,
    role: role === "all" ? undefined : role,
    status,
    group_id: groupId === "all" ? undefined : groupId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const users = useUsers(listParams);
  const total = users.data?.total ?? 0;
  const extraFilters = (role !== "all" ? 1 : 0) + (groupId !== "all" ? 1 : 0);
  const filtered = Boolean(query) || extraFilters > 0 || status !== "active";

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const clearFilters = () =>
    reset(() => {
      setRole("all");
      setGroupId("all");
    });
  const open = (u: User) => router.push(`/admin/users/${u.id}`);

  const groupOptions = [
    { value: "all", label: "All groups" },
    ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
  ];
  const roleOptions: { value: RoleFilter; label: string }[] = [
    { value: "all", label: "All roles" },
    { value: "admin", label: "Admins" },
    { value: "member", label: "Members" },
  ];

  return (
    <Page>
      <PageHeader
        title="Users"
        description="People who can sign in, their role, and the groups that decide what they can see."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlusIcon />
            Add user
          </Button>
        }
      />

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label="User list">
        <div className="flex flex-col gap-4 border-b p-4 md:px-6">
          <FilterTabs
            label="Status"
            value={status}
            onChange={(v) => reset(() => setStatus(v))}
            className="w-full sm:w-auto"
            options={[
              { value: "active", label: "Active", icon: UserCheckIcon },
              { value: "inactive", label: "Deactivated", icon: UserXIcon },
              { value: "all", label: "All", icon: UsersIcon },
            ]}
          />
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <IconInput
                icon={SearchIcon}
                value={q}
                onChange={(e) => reset(() => setQ(e.target.value))}
                placeholder="Search users"
                aria-label="Search users"
                type="search"
              />
            </div>
            <div className="hidden gap-2 md:flex">
              <SimpleSelect
                label="Filter by group"
                value={groupId}
                onChange={(v) => reset(() => setGroupId(v))}
                options={groupOptions}
              />
              <SimpleSelect
                label="Filter by role"
                value={role}
                onChange={(v) => reset(() => setRole(v))}
                options={roleOptions}
              />
            </div>
            <Button
              variant="outline"
              className="md:hidden"
              onClick={() => setFiltersOpen(true)}
              aria-label="Filters"
            >
              <SlidersHorizontalIcon />
              {extraFilters > 0 && <Badge variant="ink">{extraFilters}</Badge>}
            </Button>
          </div>
          {extraFilters > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {extraFilters} filter{extraFilters > 1 ? "s" : ""} applied
              </span>
              <Button variant="link" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          )}
        </div>

        {users.isPending ? (
          <ListSkeleton />
        ) : users.isError ? (
          <div className="p-4">
            <ErrorState error={users.error} onRetry={() => users.refetch()} />
          </div>
        ) : users.data.items.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={filtered ? "No users match" : "No users yet"}
            description={
              filtered ? "Try another search, or clear the filters." : "Add the first person to get started."
            }
          />
        ) : (
          <>
            {/* Phones: a list of large tap targets */}
            <ul className="divide-y md:hidden">
              {users.data.items.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => open(u)}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                    data-testid={`user-card-${u.email}`}
                  >
                    <UserAvatar name={u.name} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate font-medium text-sm">
                        {u.name}{" "}
                        {u.id === me.id && <span className="font-normal text-muted-foreground">(you)</span>}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">{u.email}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        <RoleBadge role={u.role} />
                        {!u.is_active && <Badge variant="outline">Deactivated</Badge>}
                      </span>
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            {/* Tablet and desktop: a table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden lg:table-cell">Groups</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden xl:table-cell">Last sign-in</TableHead>
                    <TableHead className="w-12 pr-6">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.items.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer"
                      onClick={() => open(u)}
                      data-testid={`user-row-${u.email}`}
                    >
                      <TableCell className="py-4 pl-6">
                        <a
                          href={`/admin/users/${u.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            open(u);
                          }}
                          className="flex items-center gap-4 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        >
                          <UserAvatar name={u.name} />
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium">
                              {u.name}{" "}
                              {u.id === me.id && (
                                <span className="font-normal text-muted-foreground text-xs">(you)</span>
                              )}
                            </span>
                            <span className="truncate text-muted-foreground text-xs">{u.email}</span>
                          </span>
                        </a>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <GroupChips groups={u.groups} hideSystem />
                      </TableCell>
                      <TableCell>
                        <UserStatus active={u.is_active} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground tabular xl:table-cell">
                        {relativeTime(u.last_login_at)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" aria-hidden />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {users.data && total > 0 && (
          <div className="flex items-center justify-between gap-4 border-t px-4 py-4 text-muted-foreground text-sm md:px-6">
            <span className="tabular">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="px-4 pt-6">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow the list by group or role.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <SimpleSelect
              label="Filter by group"
              value={groupId}
              onChange={(v) => reset(() => setGroupId(v))}
              options={groupOptions}
            />
            <SimpleSelect
              label="Filter by role"
              value={role}
              onChange={(v) => reset(() => setRole(v))}
              options={roleOptions}
            />
          </div>
          <SheetFooter className="flex-row px-4 pb-6">
            <Button variant="outline" className="flex-1" onClick={clearFilters} disabled={extraFilters === 0}>
              <XIcon />
              Clear
            </Button>
            <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AddUserWizard open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
