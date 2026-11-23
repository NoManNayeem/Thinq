"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarIcon,
  ClockIcon,
  KeyRoundIcon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { GroupChip, RoleBadge } from "@/components/common/badges";
import { PasswordInput } from "@/components/common/inputs";
import { DescriptionList, Page, PageHeader, Panel } from "@/components/common/page";
import { UserAvatar } from "@/components/common/user-avatar";
import { useCurrentUser } from "@/components/shell/current-user";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/client";
import { useAuthConfig, useChangePassword } from "@/lib/api/queries";
import { dateTime, relativeTime } from "@/lib/format";

export function Profile() {
  const { user, session } = useCurrentUser();
  return (
    <Page className="max-w-4xl">
      <PageHeader
        leading={<UserAvatar name={user.name} size="lg" />}
        title={user.name}
        description={user.title ?? user.email}
        meta={<RoleBadge role={user.role} />}
      />

      <Panel icon={UserCircleIcon} title="Account">
        <DescriptionList
          items={[
            { label: "Email", icon: MailIcon, value: user.email },
            { label: "Role", icon: ShieldCheckIcon, value: <RoleBadge role={user.role} /> },
            { label: "Member since", icon: CalendarIcon, value: dateTime(user.created_at) },
            { label: "This session ends", icon: ClockIcon, value: dateTime(session.expires_at) },
          ]}
        />
      </Panel>

      <Panel
        icon={UsersRoundIcon}
        title="Your groups"
        description="Groups decide which documents you can see. Only an Admin can change them."
      >
        <ul className="divide-y" data-testid="profile-groups">
          {user.groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-4 px-4 py-4 md:px-6">
              <GroupChip group={g} />
              <span className="text-muted-foreground text-xs">
                {g.is_system ? "Everyone in your organization" : "Assigned by an Admin"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <PasswordPanel hasPassword={user.has_password} lastLogin={user.last_login_at} />
    </Page>
  );
}

function PasswordPanel({ hasPassword, lastLogin }: { hasPassword: boolean; lastLogin: string | null }) {
  const config = useAuthConfig();
  const min = config.data?.password_min_length ?? 10;
  const change = useChangePassword();

  const schema = z
    .object({
      current: hasPassword ? z.string().min(1, "Enter your current password.") : z.string(),
      next: z.string().min(min, `Use at least ${min} characters.`).max(128),
      confirm: z.string(),
    })
    .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { current: "", next: "", confirm: "" },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((v) =>
    change.mutate(
      { current_password: hasPassword ? v.current : null, new_password: v.next },
      {
        onSuccess: () => {
          form.reset();
          toast.success("Password updated", { description: "Your other sessions were signed out." });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    ),
  );

  return (
    <Panel
      icon={KeyRoundIcon}
      title={hasPassword ? "Change password" : "Set a password"}
      description={
        hasPassword
          ? `Last signed in ${relativeTime(lastLogin).toLowerCase()}. Changing it signs out your other sessions.`
          : "You currently sign in without a password. Set one to sign in with your email."
      }
    >
      <form onSubmit={submit} noValidate className="p-4 md:p-6">
        <FieldGroup className="max-w-md gap-6">
          {hasPassword && (
            <Field data-invalid={!!errors.current}>
              <FieldLabel htmlFor="current">Current password</FieldLabel>
              <PasswordInput
                id="current"
                icon={LockIcon}
                autoComplete="current-password"
                {...form.register("current")}
              />
              <FieldError errors={[errors.current]} />
            </Field>
          )}
          <Field data-invalid={!!errors.next}>
            <FieldLabel htmlFor="next">New password</FieldLabel>
            <PasswordInput
              id="next"
              icon={KeyRoundIcon}
              autoComplete="new-password"
              {...form.register("next")}
            />
            <FieldDescription>At least {min} characters. A short sentence works well.</FieldDescription>
            <FieldError errors={[errors.next]} />
          </Field>
          <Field data-invalid={!!errors.confirm}>
            <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm"
              icon={KeyRoundIcon}
              autoComplete="new-password"
              {...form.register("confirm")}
            />
            <FieldError errors={[errors.confirm]} />
          </Field>
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Spinner /> : <KeyRoundIcon />}
              {hasPassword ? "Update password" : "Set password"}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Panel>
  );
}
