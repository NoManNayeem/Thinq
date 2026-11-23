"use client";

import {
  ArrowRightIcon,
  BadgeCheckIcon,
  FileClockIcon,
  FileLockIcon,
  FilesIcon,
  FolderSyncIcon,
  GitForkIcon,
  LogInIcon,
  type LucideIcon,
  MessageSquareQuoteIcon,
  QuoteIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { IconTile } from "@/components/common/page";
import { Doodle } from "@/components/marketing/doodle";
import { MotionProvider, Reveal } from "@/components/marketing/reveal";
import { TrustScene } from "@/components/marketing/trust-scene";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";

const PROBLEMS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FileClockIcon,
    title: "The newest file isn't the approved one",
    body: "A draft sits next to the real version, and search shows the draft first.",
  },
  {
    icon: FilesIcon,
    title: "Two versions, no clear answer",
    body: "Only a memo somewhere says which form is current, so people ask around instead.",
  },
  {
    icon: FileLockIcon,
    title: "Confidential files sit next to everyday ones",
    body: "An assistant that reads everything will repeat what it should never have seen.",
  },
];

const STEPS: { icon: LucideIcon; title: string; body: string; badge?: string }[] = [
  {
    icon: FolderSyncIcon,
    title: "Bring in your documents",
    body: "Point Thinq at a folder and your manifest of owners, statuses and access groups. Gaps are flagged, not hidden.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Thinq checks trust and access",
    body: "Every document gets an owner, a status and one access group. Admins fix what's missing from a single queue.",
  },
  {
    icon: MessageSquareQuoteIcon,
    title: "Ask, and see where the answer came from",
    body: "Answers come from approved documents you're allowed to see, with the source and its status every time.",
    badge: "In development",
  },
];

const PRINCIPLES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheckIcon,
    title: "Access is checked on every request",
    body: "Groups are read live. Remove someone from Finance and their very next request can't see Finance files.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Approved beats newest",
    body: "Official versions outrank drafts and outdated copies, and drafts are labelled as drafts.",
  },
  {
    icon: QuoteIcon,
    title: "Every answer cites its source",
    body: "Title, owner, status and review date — or a plain “I don't know” when nothing supports an answer.",
  },
  {
    icon: ScrollTextIcon,
    title: "Everything is on the record",
    body: "Sign-ins, access changes and document fixes are written to a permanent audit log.",
  },
];

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <Reveal className="mx-auto flex max-w-2xl flex-col gap-4 text-center">
      <p className="font-medium text-link text-sm">{eyebrow}</p>
      <h2 className="font-semibold text-2xl tracking-tight">{title}</h2>
      {body && <p className="text-base text-muted-foreground">{body}</p>}
    </Reveal>
  );
}

export function Landing() {
  return (
    <MotionProvider>
      <div className="min-h-svh bg-canvas">
        <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
            <Link
              href="/"
              aria-label="Thinq home"
              className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <Logo />
            </Link>
            <nav
              aria-label="Sections"
              className="hidden items-center gap-8 text-muted-foreground text-sm md:flex"
            >
              <a href="#how" className="hover:text-foreground">
                How it works
              </a>
              <a href="#trust" className="hover:text-foreground">
                Trust
              </a>
              <a href="#open-source" className="hover:text-foreground">
                Open source
              </a>
            </nav>
            <ButtonLink href="/sign-in" variant="outline">
              <LogInIcon />
              Sign in
            </ButtonLink>
          </div>
        </header>

        <main id="main">
          {/* Hero */}
          <section className="relative overflow-hidden" aria-labelledby="hero-title">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"
            />
            <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:px-8 md:py-24 lg:grid-cols-2">
              <div className="flex flex-col gap-6">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <Badge variant="outline" className="h-8 px-3">
                    <GitForkIcon aria-hidden />
                    Open source · self-hosted
                  </Badge>
                </motion.div>
                <motion.h1
                  id="hero-title"
                  className="font-semibold text-2xl tracking-tight"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.05 }}
                >
                  Answers your team can trust — from documents they're allowed to see.
                </motion.h1>
                <motion.p
                  className="max-w-xl text-base text-muted-foreground"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.12 }}
                >
                  Thinq is your organization's knowledge base with the guardrails built in: approved versions
                  come first, access is checked on every request, and every answer shows where it came from.
                </motion.p>
                <motion.div
                  className="flex flex-col gap-2 sm:flex-row"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <ButtonLink href="/sign-in" size="lg">
                    Sign in to Thinq
                    <ArrowRightIcon />
                  </ButtonLink>
                  <ButtonLink href="#how" external size="lg" variant="ghost">
                    See how it works
                  </ButtonLink>
                </motion.div>
              </div>
              <motion.div
                className="relative"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                <TrustScene className="relative z-10 mx-auto max-w-md" />
                <motion.div
                  aria-hidden
                  className="-bottom-12 -left-8 absolute z-0 hidden w-48 lg:block"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                >
                  <Doodle name="reading-side" className="w-full" />
                </motion.div>
              </motion.div>
            </div>
          </section>

          {/* Problem */}
          <section className="border-y bg-background py-16 md:py-24" aria-labelledby="problem-title">
            <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <Reveal className="flex flex-col gap-6">
                <p className="font-medium text-link text-sm">Sound familiar?</p>
                <h2 id="problem-title" className="font-semibold text-2xl tracking-tight">
                  The problem isn&apos;t search. It&apos;s knowing what to trust.
                </h2>
                <p className="text-base text-muted-foreground">
                  Most files don&apos;t say who owns them, whether they&apos;re approved, or who may see them.
                  An assistant built on top of that just repeats the same mistakes, faster.
                </p>
                <Doodle name="sitting-reading" className="hidden w-64 sm:block" />
              </Reveal>
              <ul className="flex flex-col gap-4">
                {PROBLEMS.map((p, i) => (
                  <Reveal
                    as="li"
                    key={p.title}
                    delay={i * 0.08}
                    className="flex gap-4 rounded-xl border bg-card p-6 shadow-xs"
                  >
                    <IconTile icon={p.icon} />
                    <div className="flex flex-col gap-1">
                      <h3 className="font-semibold text-base">{p.title}</h3>
                      <p className="text-muted-foreground text-sm">{p.body}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>

          {/* How it works */}
          <section id="how" className="scroll-mt-16 py-16 md:py-24" aria-label="How it works">
            <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 md:px-8">
              <SectionHeading
                eyebrow="How it works"
                title="Trust and access first. The AI comes after."
                body="Thinq only ever reads what the person asking is allowed to see, so the answer can't leak more than they could find themselves."
              />
              <ol className="grid gap-6 md:grid-cols-3">
                {STEPS.map((s, i) => (
                  <Reveal
                    as="li"
                    key={s.title}
                    delay={i * 0.1}
                    className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <IconTile icon={s.icon} tone="ink" />
                      <span className="font-semibold text-muted-foreground text-sm tabular">0{i + 1}</span>
                    </div>
                    <h3 className="font-semibold text-base">{s.title}</h3>
                    <p className="text-muted-foreground text-sm">{s.body}</p>
                    {s.badge && (
                      <Badge variant="outline" className="mt-auto">
                        {s.badge}
                      </Badge>
                    )}
                  </Reveal>
                ))}
              </ol>
            </div>
          </section>

          {/* Principles — the 30% ink band */}
          <section
            id="trust"
            className="scroll-mt-16 bg-ink py-16 text-ink-foreground md:py-24"
            aria-labelledby="trust-title"
          >
            <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 md:px-8">
              <Reveal className="flex max-w-2xl flex-col gap-4">
                <p className="font-medium text-ink-accent text-sm">Built-in guardrails</p>
                <h2 id="trust-title" className="font-semibold text-2xl tracking-tight">
                  Four promises Thinq keeps on every request.
                </h2>
              </Reveal>
              <ul className="grid gap-6 sm:grid-cols-2">
                {PRINCIPLES.map((p, i) => (
                  <Reveal
                    as="li"
                    key={p.title}
                    delay={i * 0.08}
                    className="flex gap-4 rounded-xl border border-ink-border bg-ink-hover p-6"
                  >
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink-active"
                      aria-hidden
                    >
                      <p.icon className="size-5 text-ink-accent" />
                    </span>
                    <div className="flex flex-col gap-1">
                      <h3 className="font-semibold text-base">{p.title}</h3>
                      <p className="text-ink-muted text-sm">{p.body}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>

          {/* Open source */}
          <section id="open-source" className="scroll-mt-16 py-16 md:py-24" aria-labelledby="oss-title">
            <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-2">
              <Reveal className="flex flex-col gap-6">
                <p className="font-medium text-link text-sm">Open source</p>
                <h2 id="oss-title" className="font-semibold text-2xl tracking-tight">
                  Runs on your servers, with one command.
                </h2>
                <p className="text-base text-muted-foreground">
                  Apache 2.0 licensed. Your documents and your people stay in your own PostgreSQL database.
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {[
                    { icon: ServerIcon, text: "Self-hosted with Docker Compose" },
                    { icon: GitForkIcon, text: "Apache 2.0 — use, change and share it" },
                    { icon: ShieldCheckIcon, text: "Accessible, audited, and tested end to end" },
                  ].map((f) => (
                    <li key={f.text} className="flex items-center gap-2">
                      <f.icon className="size-4 text-muted-foreground" aria-hidden />
                      {f.text}
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={0.1} className="relative">
                <div className="overflow-hidden rounded-xl border bg-ink shadow-lg">
                  <div className="flex items-center gap-2 border-ink-border border-b px-4 py-2 text-ink-muted text-xs">
                    <TerminalIcon className="size-4" aria-hidden />
                    Terminal
                  </div>
                  <pre className="overflow-x-auto p-6 font-mono text-ink-foreground text-sm">
                    <code>
                      <span className="text-ink-muted">$ </span>cp .env.example .env{"\n"}
                      <span className="text-ink-muted">$ </span>docker compose up -d{"\n"}
                      <span className="text-ink-accent">✓ Thinq is running at localhost:3000</span>
                    </code>
                  </pre>
                </div>
                <Doodle
                  name="coffee"
                  className="-bottom-16 -right-4 pointer-events-none absolute hidden w-40 lg:block"
                />
              </Reveal>
            </div>
          </section>

          {/* Closing call to action */}
          <section className="px-4 pb-16 md:px-8 md:pb-24" aria-labelledby="cta-title">
            <Reveal className="mx-auto flex max-w-4xl flex-col items-center gap-6 rounded-2xl border bg-card p-8 text-center shadow-xs md:p-12">
              <h2 id="cta-title" className="font-semibold text-xl tracking-tight">
                See which of your documents your team can actually trust.
              </h2>
              <p className="max-w-xl text-muted-foreground text-sm">
                Sign in with your work account, or try the demo accounts if your administrator has turned them
                on.
              </p>
              <ButtonLink href="/sign-in" size="lg" variant="outline">
                <LogInIcon />
                Sign in
              </ButtonLink>
            </Reveal>
          </section>
        </main>

        <footer className="border-t bg-background">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-muted-foreground text-sm md:flex-row md:items-center md:justify-between md:px-8">
            <Logo />
            <p>Open source · Apache 2.0 · Illustrations: Open Doodles (CC0)</p>
            <nav aria-label="Footer" className="flex gap-6">
              <Link href="/status" className="hover:text-foreground">
                System status
              </Link>
              <Link href="/sign-in" className="hover:text-foreground">
                Sign in
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </MotionProvider>
  );
}
