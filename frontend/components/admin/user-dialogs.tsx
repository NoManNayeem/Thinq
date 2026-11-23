"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BriefcaseIcon, CopyIcon, KeyRoundIcon, SaveIcon, SparklesIcon, UserIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { IconInput } from "@/components/common/inputs";
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
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, type UserDetail } from "@/lib/api/client";
import { useAuthConfig, useSetPassword, useUpdateUser } from "@/lib/api/queries";

export function EditProfileDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateUser(user.id);
  const schema = z.object({
    name: z.string().trim().min(1, "Enter a name.").max(200),
    title: z.string().trim().max(200),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    values: { name: user.name, title: user.title ?? "" },
  });
  const { errors, isDirty } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <form
          id="edit-profile"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            update.mutate(
              { name: v.name, title: v.title || null },
              {
                onSuccess: () => {
                  toast.success("Profile saved");
                  onOpenChange(false);
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            ),
          )}
        >
          <FieldGroup className="gap-6">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="ep-name">Full name</FieldLabel>
              <IconInput icon={UserIcon} id="ep-name" {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ep-title">Job title</FieldLabel>
              <IconInput icon={BriefcaseIcon} id="ep-title" {...form.register("title")} />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-profile" disabled={!isDirty || update.isPending}>
            {update.isPending ? <Spinner /> : <SaveIcon />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useAuthConfig();
  const min = config.data?.password_min_length ?? 10;
  const set = useSetPassword(user.id);
  const schema = z.object({ password: z.string().min(min, `Use at least ${min} characters.`).max(128) });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: "" } });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) form.reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user.has_password ? "Reset password" : "Set password"}</DialogTitle>
          <DialogDescription>
            {user.name} will be signed out everywhere and must use the new password.
          </DialogDescription>
        </DialogHeader>
        <form
          id="reset-password"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            set.mutate(v.password, {
              onSuccess: () => {
                toast.success("Password updated", { description: "Share it with them securely." });
                onOpenChange(false);
                form.reset();
              },
              onError: (e) => toast.error(errorMessage(e)),
            }),
          )}
        >
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="rp-password">New password</FieldLabel>
            <IconInput
              icon={KeyRoundIcon}
              id="rp-password"
              type="text"
              spellCheck={false}
              autoComplete="new-password"
              className="font-mono"
              {...form.register("password")}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => form.setValue("password", generatePassword(), { shouldValidate: true })}
              >
                <SparklesIcon />
                Generate
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(form.getValues("password"))
                    .then(() => toast.success("Password copied"))
                }
              >
                <CopyIcon />
                Copy
              </Button>
            </div>
            <FieldDescription>At least {min} characters.</FieldDescription>
            <FieldError errors={[errors.password]} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="reset-password" disabled={set.isPending}>
            {set.isPending ? <Spinner /> : <KeyRoundIcon />}
            Save password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
