"use client";

import { BadgeCheckIcon, FlaskConicalIcon, QuoteIcon, ShieldCheckIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DemoUserList } from "@/components/auth/demo-users";
import { SignInForm, type SignInValues } from "@/components/auth/sign-in-form";
import { Logo } from "@/components/brand";
import { errorMessage } from "@/lib/api/client";
import { useAuthConfig, useDemoLogin, useDemoUsers, useLogin, useMe } from "@/lib/api/queries";
import { safeNext } from "@/lib/navigation";

const PRINCIPLES = [
  {
    icon: ShieldCheckIcon,
    title: "Access is checked on every question",
    body: "People only see what their groups allow, and changes apply immediately.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Approved content comes first",
    body: "Official, reviewed documents outrank newer drafts and outdated copies.",
  },
  {
    icon: QuoteIcon,
    title: "Every answer shows its source",
    body: "Each answer links to the document it came from, with its owner and status.",
  },
];

export function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next")) as Route;
  const me = useMe();
  const config = useAuthConfig();
  const demoEnabled = config.data?.demo_mode === true;
  const demoUsers = useDemoUsers(demoEnabled);
  const login = useLogin();
  const demoLogin = useDemoLogin();
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (me.isSuccess) router.replace(next);
  }, [me.isSuccess, next, router]);

  const submit = (values: SignInValues) => login.mutate(values, { onSuccess: () => router.replace(next) });

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* 30 — ink brand panel */}
      <aside className="hidden flex-col justify-between bg-ink p-12 text-ink-foreground lg:flex">
        <Logo tone="ink" />
        <div className="flex max-w-md flex-col gap-12">
          <div className="flex flex-col gap-4">
            <p className="font-medium text-ink-accent text-sm">Organizational knowledge</p>
            <h2 className="font-semibold text-2xl tracking-tight">Answers your team can trust.</h2>
            <p className="text-base text-ink-muted">
              One place to ask how things are done, built on your organization&apos;s approved knowledge and
              its access rules.
            </p>
          </div>
          <ul className="flex flex-col gap-6">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-active"
                  aria-hidden
                >
                  <p.icon className="size-5 text-ink-accent" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-medium text-base">{p.title}</span>
                  <span className="text-ink-muted text-sm">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-ink-muted text-xs">Open source · Apache 2.0</p>
      </aside>

      {/* 60 — neutral work area */}
      <main className="flex flex-col items-center px-4 py-8 md:px-8 lg:justify-center lg:py-12">
        <div className="mb-8 w-full max-w-md lg:hidden">
          <Logo />
        </div>
        <div className="flex w-full max-w-md flex-col gap-8">
          <section
            className="rounded-2xl border bg-card p-6 shadow-xs md:p-8"
            aria-labelledby="sign-in-heading"
          >
            <div className="mb-8 flex flex-col gap-2">
              <h1 id="sign-in-heading" className="font-semibold text-xl tracking-tight">
                Sign in to Thinq
              </h1>
              <p className="text-muted-foreground text-sm">Use your work email and password.</p>
            </div>
            <SignInForm onSubmit={submit} pending={login.isPending} error={login.error} />
            <p className="mt-6 text-muted-foreground text-xs">
              Forgot your password? Ask an Admin in your organization to reset it.
            </p>
          </section>

          {demoEnabled && (
            <section className="flex flex-col gap-4" aria-labelledby="demo-heading">
              <div className="flex items-center gap-2">
                <FlaskConicalIcon className="size-4 text-muted-foreground" aria-hidden />
                <h2 id="demo-heading" className="font-medium text-sm">
                  Demo accounts
                </h2>
              </div>
              <DemoUserList
                users={demoUsers.data}
                loading={demoUsers.isPending}
                pendingId={pendingId}
                onSelect={(user) => {
                  setPendingId(user.id);
                  demoLogin.mutate(user.id, {
                    onSuccess: () => router.replace(next),
                    onError: (e) => {
                      setPendingId(null);
                      toast.error(errorMessage(e));
                    },
                  });
                }}
              />
              <p className="text-muted-foreground text-xs">
                Demo sign-in is on for this environment. Turn it off for real deployments.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
