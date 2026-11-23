import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Neutral avatar: identity comes from the initials, not from colour. */
export function UserAvatar({
  name,
  size = "default",
  className,
}: {
  name: string;
  seed?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn(size === "lg" && "size-12", className)}>
      <AvatarFallback className="bg-secondary font-medium text-secondary-foreground text-xs">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
