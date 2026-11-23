import { ArrowLeftIcon, CompassIcon } from "lucide-react";
import { Logo } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button-link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-canvas p-6 text-center">
      <Logo />
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border bg-card p-8 shadow-xs">
        <span className="flex size-12 items-center justify-center rounded-xl bg-secondary" aria-hidden>
          <CompassIcon className="size-6 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight">Page not found</h1>
          <p className="text-muted-foreground text-sm">
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
        </div>
        <ButtonLink href="/">
          <ArrowLeftIcon />
          Back to Thinq
        </ButtonLink>
      </div>
    </main>
  );
}
