import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { Route } from "next";
import Link from "next/link";
import { buttonVariants } from "./button";

type Props = VariantProps<typeof buttonVariants> & {
  className?: string;
  children: React.ReactNode;
} & ({ href: Route; external?: false } | { href: string; external: true });

/**
 * Looks like a button, behaves like a link: navigation stays a real `<a>` so assistive
 * technology announces it as a link. Use `Button` for actions, this for navigation.
 */
export function ButtonLink({
  href,
  external,
  variant = "default",
  size = "default",
  className,
  children,
}: Props) {
  const classes = cn(buttonVariants({ variant, size }), className);
  const data = { "data-slot": "button", "data-variant": variant ?? "default" };
  if (external) {
    return (
      <a href={href} className={classes} {...data}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href as Route} className={classes} {...data}>
      {children}
    </Link>
  );
}
