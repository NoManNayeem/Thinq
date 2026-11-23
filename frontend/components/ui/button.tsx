import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * Sizes follow the touch-target rule: every button is at least 48 px tall on small
 * and touch screens, and steps down to 40 px (32 px for `sm`) with a fine pointer.
 * `default` is the screen's single primary action and the only accent-coloured one.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-base font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive md:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        outline: "border-input bg-background text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive-strong text-white shadow-xs hover:bg-destructive-strong/90 focus-visible:ring-destructive/40",
        "destructive-ghost": "text-destructive hover:bg-destructive/10",
        link: "h-auto! px-0! text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 gap-2 px-5 md:h-10 md:px-4 md:pointer-coarse:h-12",
        sm: "h-12 gap-2 px-4 md:h-8 md:px-3 md:pointer-coarse:h-12",
        lg: "h-12 gap-2 px-6",
        icon: "size-12 md:size-10 md:pointer-coarse:size-12",
        "icon-sm": "size-12 md:size-8 md:pointer-coarse:size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
