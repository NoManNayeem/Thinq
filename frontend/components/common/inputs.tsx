"use client";

import { EyeIcon, EyeOffIcon, type LucideIcon } from "lucide-react";
import { forwardRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<typeof Input>;

/** Text input with a leading icon. */
export const IconInput = forwardRef<HTMLInputElement, InputProps & { icon: LucideIcon }>(function IconInput(
  { icon: Icon, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <Icon
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-4 text-muted-foreground md:left-3"
        aria-hidden
      />
      <Input ref={ref} className={cn("pl-12 md:pl-10", className)} {...props} />
    </div>
  );
});

/** Password input with a show/hide toggle, as people expect from other apps. */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps & { icon?: LucideIcon }>(
  function PasswordInput({ icon: Icon, className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        {Icon && (
          <Icon
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-4 text-muted-foreground md:left-3"
            aria-hidden
          />
        )}
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-12", Icon && "pl-12 md:pl-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-0 right-0 flex h-full w-12 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
    );
  },
);
