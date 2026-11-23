"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, LockIcon, LogInIcon, MailIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { IconInput, PasswordInput } from "@/components/common/inputs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api/client";

const schema = z.object({
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(1, "Enter your password."),
});

export type SignInValues = z.infer<typeof schema>;

export function SignInForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (values: SignInValues) => void;
  pending: boolean;
  error: unknown;
}) {
  const form = useForm<SignInValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-label="Sign in">
      <FieldGroup className="gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <IconInput
            icon={MailIcon}
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="you@company.com"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <PasswordInput
            icon={LockIcon}
            id="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : <LogInIcon />}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
