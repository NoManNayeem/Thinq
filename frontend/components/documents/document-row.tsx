import { ChevronRightIcon, FileTextIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { GroupChip } from "@/components/common/badges";
import { IconTile } from "@/components/common/page";
import { Badge } from "@/components/ui/badge";
import type { DocumentSummary } from "@/lib/api/client";
import { dateTime } from "@/lib/format";
import { StatusBadge } from "./status-badge";

function formatDate(value: string | null) {
  return value ? dateTime(value).replace(/, \d\d:\d\d$/, "") : null;
}

export function DocumentRow({ doc }: { doc: DocumentSummary }) {
  const reviewed = formatDate(doc.last_reviewed);
  return (
    <li>
      <Link
        href={`/library/${doc.id}`}
        className="flex items-start gap-4 px-4 py-4 outline-none transition-colors hover:bg-muted focus-visible:bg-muted md:items-center md:px-6"
        data-testid={`doc-row-${doc.source_path}`}
      >
        <IconTile icon={FileTextIcon} className="hidden sm:flex" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{doc.title}</span>
            {!doc.is_registered && <Badge variant="destructive">Unregistered</Badge>}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {doc.owner.name ?? "No owner"} · {reviewed ? `Reviewed ${reviewed}` : "Never reviewed"} ·{" "}
            {doc.source_path}
          </span>
          {doc.match && <span className="line-clamp-2 text-muted-foreground text-xs">{doc.match}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
            <StatusBadge status={doc.status} />
            {doc.access_group && <GroupChip group={doc.access_group} />}
          </span>
        </span>
        <span className="hidden items-center gap-2 md:flex">
          {doc.access_group && <GroupChip group={doc.access_group} />}
          <StatusBadge status={doc.status} />
        </span>
        {doc.open_flag_count ? (
          <span
            className="flex items-center gap-1 text-warning text-xs"
            title={`${doc.open_flag_count} open flag${doc.open_flag_count > 1 ? "s" : ""}`}
          >
            <TriangleAlertIcon className="size-4" aria-hidden />
            <span className="tabular">{doc.open_flag_count}</span>
            <span className="sr-only">open flags</span>
          </span>
        ) : null}
        <ChevronRightIcon className="mt-2 size-4 shrink-0 text-muted-foreground md:mt-0" aria-hidden />
      </Link>
    </li>
  );
}
