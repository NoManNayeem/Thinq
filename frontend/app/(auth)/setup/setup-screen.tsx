"use client";

import { LockIcon, MailIcon, RocketIcon, UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { IconInput, PasswordInput } from "@/components/common/inputs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage, unwrap } from "@/lib/api/client";
import { useAuthConfig, useSetupStatus } from "@/lib/api/queries";

/** First run: create the first Admin. Closed as soon as any user exists. */
export function SetupScreen() {
  const status = useSetupStatus();
  const config = useAuthConfig();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const min = config.data?.password_min_length ?? 12;

  useEffect(() => {
    if (status.data && !status.data.needed) window.location.replace("/sign-in");
  }, [status.data]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-canvas px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-8 rounded-xl border bg-card p-6 shadow-xs md:p-8">
        <Logo />
        <div className="flex flex-col gap-2">
          <h1 className="font-semibold text-xl tracking-tight">Set up Thinq</h1>
          <p className="text-muted-foreground text-sm">
            Create the first Admin account. You can then add people, groups and documents.
          </p>
        </div>
        <form
          noValidate
          aria-label="Create the first Admin"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              await unwrap(
                api.POST("/api/auth/setup", { body: { name: name.trim(), email: email.trim(), password } }),
              );
              window.location.replace("/admin/sources");
            } catch (err) {
              setError(err);
              setPending(false);
            }
          }}
        >
          <FieldGroup className="gap-6">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="setup-name">Your name</FieldLabel>
              <IconInput
                icon={UserIcon}
                id="setup-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-email">Work email</FieldLabel>
              <IconInput
                icon={MailIcon}
                id="setup-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-password">Password</FieldLabel>
              <PasswordInput
                icon={LockIcon}
                id="setup-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldDescription>At least {min} characters.</FieldDescription>
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || !name.trim() || !email.includes("@") || password.length < min}
            >
              {pending ? <Spinner /> : <RocketIcon />}
              Create Admin and continue
            </Button>
          </FieldGroup>
        </form>
      </div>
    </main>
  );
}
