import { Badge } from "@/components/ui/badge";
import type { DocumentStatus } from "@/lib/api/client";
import { STATUS } from "@/lib/documents";

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const meta = STATUS[status];
  return (
    <Badge variant={meta.badge} data-testid="status-badge" data-status={status}>
      <meta.icon aria-hidden />
      {meta.label}
    </Badge>
  );
}
