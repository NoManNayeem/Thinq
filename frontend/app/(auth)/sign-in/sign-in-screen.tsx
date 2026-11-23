"use client";

import { ArrowLeftIcon, FlaskConicalIcon } from "lucide-react";
import { motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DemoUserList } from "@/components/auth/demo-users";
import { SignInForm, type SignInValues } from "@/components/auth/sign-in-form";
import { Logo } from "@/components/brand";
import { MotionProvider } from "@/components/marketing/reveal";
import { TrustScene } from "@/components/marketing/trust-scene";
import { ButtonLink } from "@/components/ui/button-link";
import { errorMessage } from "@/lib/api/client";
import { useAuthConfig, useDemoLogin, useDemoUsers, useLogin, useMe } from "@/lib/api/queries";
import { safeNext } from "@/lib/navigation";

const ease = [0.22, 1, 0.36, 1] as const;

export function SignInScreen() {
  const params = useSearchParams();
  const next = safeNext(params.get("next")) as Route;
  const me = useMe();
  const config = useAuthConfig();
  const demoEnabled = config.data?.demo_mode === true;
  const demoUsers = useDemoUsers(demoEnabled);
  const login = useLogin();
  const demoLogin = useDemoLogin();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // A full page load after signing in: "/" is the landing page for signed-out visitors and
  // the app for signed-in people, so nothing cached under the old session may be reused.
  const enter = () => window.location.replace(next);

  useEffect(() => {
    if (me.isSuccess) window.location.replace(next);
  }, [me.isSuccess, next]);

  const submit = (values: SignInValues) => login.mutate(values, { onSuccess: enter });

  return (
    <MotionProvider>
      <div className="grid min-h-svh lg:grid-cols-2">
        {/* 30 — ink brand panel with the animated product scene */}
        <aside className="relative hidden flex-col justify-between gap-12 overflow-hidden bg-ink p-12 text-ink-foreground lg:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--ink-border)_1px,transparent_1px)] [background-size:24px_24px]"
          />
          <Link
            href="/"
            className="relative w-fit rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <Logo tone="ink" />
          </Link>
          <div className="relative flex max-w-md flex-col gap-8">
            <motion.div
              className="flex flex-col gap-4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
            >
              <p className="font-medium text-ink-accent text-sm">Organizational knowledge</p>
              <h2 className="font-semibold text-2xl tracking-tight">Answers your team can trust.</h2>
              <p className="text-base text-ink-muted">
                Approved versions first. Access checked on every request. A source for every answer.
              </p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease }}
            >
              <TrustScene compact />
            </motion.div>
          </div>
          <p className="relative text-ink-muted text-xs">Open source · Apache 2.0</p>
        </aside>

        {/* 60 — neutral work area */}
        <main className="flex flex-col items-center px-4 py-8 md:px-8 lg:justify-center lg:py-12">
          <div className="mb-8 flex w-full max-w-md items-center justify-between gap-4">
            <span className="lg:hidden">
              <Logo />
            </span>
            <ButtonLink href="/" variant="ghost" className="ml-auto">
              <ArrowLeftIcon />
              Back to home
            </ButtonLink>
          </div>
          <div className="flex w-full max-w-md flex-col gap-8">
            <motion.section
              className="rounded-2xl border bg-card p-6 shadow-xs md:p-8"
              aria-labelledby="sign-in-heading"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
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
            </motion.section>

            {demoEnabled && (
              <motion.section
                className="flex flex-col gap-4"
                aria-labelledby="demo-heading"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.12, ease }}
              >
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
                      onSuccess: enter,
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
              </motion.section>
            )}
          </div>
        </main>
      </div>
    </MotionProvider>
  );
}
