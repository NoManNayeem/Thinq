"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  ClockIcon,
  CopyIcon,
  KeyRoundIcon,
  MailIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { GroupChip } from "@/components/common/badges";
import { CheckRow, ChoiceCard } from "@/components/common/choice";
import { IconInput } from "@/components/common/inputs";
import { DescriptionList } from "@/components/common/page";
import { type Step, Stepper } from "@/components/common/stepper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/client";
import { useAuthConfig, useCreateUser, useGroups } from "@/lib/api/queries";
import { plural } from "@/lib/format";

const STEPS: Step[] = [
  { id: "person", label: "Person", icon: UserIcon },
  { id: "access", label: "Access", icon: ShieldCheckIcon },
  { id: "sign-in", label: "Sign-in", icon: KeyRoundIcon },
];

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Adding a person in three short steps instead of one long form. */
export function AddUserWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const groups = useGroups(open);
  const config = useAuthConfig();
  const min = config.data?.password_min_length ?? 10;
  const create = useCreateUser();
  const [step, setStep] = useState(0);

  const schema = z
    .object({
      name: z.string().trim().min(1, "Enter their full name.").max(200),
      email: z.email("Enter a valid email address.").trim(),
      title: z.string().trim().max(200),
      role: z.enum(["member", "admin"]),
      group_ids: z.array(z.string()),
      passwordMode: z.enum(["now", "later"]),
      password: z.string().max(128),
    })
    .refine((v) => v.passwordMode === "later" || v.password.length >= min, {
      path: ["password"],
      message: `Use at least ${min} characters.`,
    });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      title: "",
      role: "member",
      group_ids: [],
      passwordMode: "now",
      password: "",
    },
  });
  const { errors } = form.formState;
  const values = useWatch({ control: form.control });
  const customGroups = (groups.data ?? []).filter((g) => !g.is_system);

  const close = () => {
    onOpenChange(false);
    setStep(0);
    form.reset();
  };

  const next = async () => {
    const fields: (keyof Values)[][] = [["name", "email", "title"], ["role", "group_ids"], []];
    if (await form.trigger(fields[step])) setStep((s) => s + 1);
  };

  const submit = form.handleSubmit((v) =>
    create.mutate(
      {
        name: v.name,
        email: v.email,
        title: v.title || null,
        role: v.role,
        group_ids: v.group_ids,
        password: v.passwordMode === "now" ? v.password : null,
      },
      {
        onSuccess: (user) => {
          toast.success(`${user.name} was added`, {
            description: v.passwordMode === "now" ? "Share their password with them securely." : undefined,
          });
          close();
          router.push(`/admin/users/${user.id}`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    ),
  );

  const selectedGroups = customGroups.filter((g) => values.group_ids?.includes(g.id));

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]?.label}
          </DialogDescription>
        </DialogHeader>
        <Stepper steps={STEPS} current={step} />

        <form
          id="add-user"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step < STEPS.length - 1) void next();
            else void submit(e);
          }}
        >
          {step === 0 && (
            <FieldGroup className="gap-6">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="au-name">Full name</FieldLabel>
                <IconInput icon={UserIcon} id="au-name" autoComplete="off" {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="au-email">Work email</FieldLabel>
                <IconInput
                  icon={MailIcon}
                  id="au-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  {...form.register("email")}
                />
                <FieldDescription>They&apos;ll use this to sign in.</FieldDescription>
                <FieldError errors={[errors.email]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="au-title">
                  Job title <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <IconInput icon={BriefcaseIcon} id="au-title" {...form.register("title")} />
              </Field>
            </FieldGroup>
          )}

          {step === 1 && (
            <FieldGroup className="gap-6">
              <FieldSet>
                <FieldLegend variant="label">Role</FieldLegend>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <div role="radiogroup" aria-label="Role" className="grid gap-2 sm:grid-cols-2">
                      <ChoiceCard
                        selected={field.value === "member"}
                        onSelect={() => field.onChange("member")}
                        icon={UserIcon}
                        title="Member"
                        description="Uses Thinq. Sees what their groups allow."
                      />
                      <ChoiceCard
                        selected={field.value === "admin"}
                        onSelect={() => field.onChange("admin")}
                        icon={ShieldCheckIcon}
                        title="Admin"
                        description="Also manages people and groups."
                      />
                    </div>
                  )}
                />
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">Groups</FieldLegend>
                <FieldDescription>
                  Everyone is included automatically. You can change this later.
                </FieldDescription>
                {customGroups.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No groups yet. Create groups from the Groups page.
                  </p>
                ) : (
                  <Controller
                    control={form.control}
                    name="group_ids"
                    render={({ field }) => (
                      <div className="flex flex-col gap-2">
                        {customGroups.map((g) => (
                          <CheckRow
                            key={g.id}
                            id={`au-g-${g.id}`}
                            checked={field.value.includes(g.id)}
                            onChange={(checked) =>
                              field.onChange(
                                checked ? [...field.value, g.id] : field.value.filter((id) => id !== g.id),
                              )
                            }
                            title={g.name}
                            description={g.description ?? plural(g.member_count, "member")}
                          />
                        ))}
                      </div>
                    )}
                  />
                )}
              </FieldSet>
            </FieldGroup>
          )}

          {step === 2 && (
            <FieldGroup className="gap-6">
              <FieldSet>
                <FieldLegend variant="label">Password</FieldLegend>
                <Controller
                  control={form.control}
                  name="passwordMode"
                  render={({ field }) => (
                    <div role="radiogroup" aria-label="Password" className="grid gap-2 sm:grid-cols-2">
                      <ChoiceCard
                        selected={field.value === "now"}
                        onSelect={() => field.onChange("now")}
                        icon={KeyRoundIcon}
                        title="Set one now"
                        description="They can sign in straight away."
                      />
                      <ChoiceCard
                        selected={field.value === "later"}
                        onSelect={() => field.onChange("later")}
                        icon={ClockIcon}
                        title="Set it later"
                        description="They can't sign in until you do."
                      />
                    </div>
                  )}
                />
              </FieldSet>
              {values.passwordMode === "now" && (
                <Field data-invalid={!!errors.password}>
                  <FieldLabel htmlFor="au-password">Initial password</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <IconInput
                      icon={KeyRoundIcon}
                      id="au-password"
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
                        className="flex-1"
                        onClick={() =>
                          form.setValue("password", generatePassword(), { shouldValidate: true })
                        }
                      >
                        <SparklesIcon />
                        Generate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Copy password"
                        disabled={!values.password}
                        onClick={() =>
                          navigator.clipboard
                            ?.writeText(values.password ?? "")
                            .then(() => toast.success("Password copied"))
                        }
                      >
                        <CopyIcon />
                      </Button>
                    </div>
                  </div>
                  <FieldDescription>
                    At least {min} characters. They can change it after signing in.
                  </FieldDescription>
                  <FieldError errors={[errors.password]} />
                </Field>
              )}
              <div className="overflow-hidden rounded-lg border">
                <p className="border-b bg-muted px-4 py-2 font-medium text-xs uppercase tracking-wide">
                  Review
                </p>
                <DescriptionList
                  compact
                  items={[
                    { label: "Name", icon: UserIcon, value: values.name },
                    { label: "Email", icon: MailIcon, value: values.email },
                    {
                      label: "Role",
                      icon: ShieldCheckIcon,
                      value: values.role === "admin" ? "Admin" : "Member",
                    },
                    {
                      label: "Groups",
                      icon: UsersRoundIcon,
                      value: (
                        <span className="flex flex-wrap justify-end gap-1">
                          {selectedGroups.length === 0
                            ? "Everyone only"
                            : selectedGroups.map((g) => <GroupChip key={g.id} group={g} />)}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </FieldGroup>
          )}
        </form>

        <DialogFooter className="sm:justify-between">
          {step === 0 ? (
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeftIcon />
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="submit" form="add-user">
              Continue
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button type="submit" form="add-user" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <UserPlusIcon />}
              Add user
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
