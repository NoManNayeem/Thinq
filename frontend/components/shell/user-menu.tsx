"use client";

import { ChevronDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { RoleBadge } from "@/components/common/badges";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/api/client";
import { useLogout } from "@/lib/api/queries";
import { useCurrentUser } from "./current-user";

/** Account menu, top-right — where people look for it in most apps. */
export function UserMenu() {
  const { user } = useCurrentUser();
  const router = useRouter();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => router.replace("/sign-in"),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-12 items-center gap-2 rounded-lg px-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:bg-muted md:h-10 md:pointer-coarse:h-12"
        aria-label="Account menu"
        data-testid="user-menu"
      >
        <UserAvatar name={user.name} size="sm" />
        <span className="hidden max-w-40 truncate font-medium text-sm md:block">{user.name}</span>
        <ChevronDownIcon className="hidden size-4 text-muted-foreground md:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-2 py-3 font-normal">
            <span className="flex flex-col">
              <span className="font-medium text-foreground text-sm">{user.name}</span>
              <span className="truncate text-muted-foreground text-xs">{user.email}</span>
            </span>
            <RoleBadge role={user.role} />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserCircleIcon />
          Your profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
            <DropdownMenuRadioItem value="light">
              <SunIcon />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon />
              Match system
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} disabled={logout.isPending}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
