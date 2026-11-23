/* biome-ignore-all lint/performance/noImgElement: small static decorative SVGs; next/image adds nothing here */
import { cn } from "@/lib/utils";

type Name = "reading-side" | "sitting-reading" | "coffee";

function Img({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      width={1024}
      height={768}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("h-auto select-none", className)}
    />
  );
}

/**
 * A CC0 Open Doodles illustration (see public/illustrations/LICENSE.md), in a
 * light-line and a dark-line version. Decorative, so it has empty alt text, and it's
 * lazy-loaded so it never delays the page on slow networks.
 *
 * `surface="ink"` always uses the light-line version, for the dark ink panels.
 */
export function Doodle({
  name,
  className,
  surface = "auto",
}: {
  name: Name;
  className?: string;
  surface?: "auto" | "ink";
}) {
  // Layout classes go on the wrapper, so they can never undo the light/dark switch below.
  return (
    <span className={cn("block", className)}>
      {surface === "ink" ? (
        <Img src={`/illustrations/${name}-dark.svg`} className="w-full" />
      ) : (
        <>
          <Img src={`/illustrations/${name}-light.svg`} className="w-full dark:hidden" />
          <Img src={`/illustrations/${name}-dark.svg`} className="hidden w-full dark:block" />
        </>
      )}
    </span>
  );
}
