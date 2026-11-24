"use client";

import {
  BadgeCheckIcon,
  CalendarClockIcon,
  CircleHelpIcon,
  LightbulbIcon,
  PencilLineIcon,
} from "lucide-react";
import { Page, PageHeader, Panel } from "@/components/common/page";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import type { ApprovalItem } from "@/lib/api/client";
import { useApprovals } from "@/lib/api/queries";
import { DocumentRow } from "./document-row";
import { ProposalCard } from "./trust";

const SECTIONS: {
  reason: ApprovalItem["reason"];
  title: string;
  description: string;
  icon: typeof PencilLineIcon;
}[] = [
  {
    reason: "awaiting_approval",
    title: "Drafts awaiting approval",
    description: "Approving one retires the family's previous approved version in the same step.",
    icon: PencilLineIcon,
  },
  {
    reason: "status_unknown",
    title: "No status recorded",
    description: "Nobody has said whether these are approved, so answers flag them.",
    icon: CircleHelpIcon,
  },
  {
    reason: "review_overdue",
    title: "Review overdue",
    description: "Approved, but nobody has confirmed they're still correct recently.",
    icon: CalendarClockIcon,
  },
];

/** Everything this person can decide: owners see their documents, Admins see all they can access. */
export function ApprovalsScreen() {
  const approvals = useApprovals();
  const data = approvals.data;
  const empty = data && data.documents.length === 0 && data.proposals.length === 0;
  return (
    <Page>
      <PageHeader
        title="Approvals"
        description="Decide which documents are official. Only a document's owner or an Admin can change its status, and every change is recorded."
      />
      {approvals.isPending ? (
        <ListSkeleton />
      ) : approvals.isError ? (
        <ErrorState error={approvals.error} onRetry={() => approvals.refetch()} />
      ) : empty ? (
        <div className="rounded-xl border bg-card shadow-xs">
          <EmptyState
            icon={BadgeCheckIcon}
            title="Nothing to decide"
            description="Drafts, documents without a status and overdue reviews you can act on appear here."
            testId="approvals-empty"
          />
        </div>
      ) : (
        <>
          {data && data.proposals.length > 0 && (
            <Panel
              icon={LightbulbIcon}
              title="Suggested by approved documents"
              description="An approved document names another as current or retired. Nothing changes until you confirm."
            >
              <div className="flex flex-col gap-4 p-4 md:p-6" data-testid="proposals">
                {data.proposals.map((p) => (
                  <ProposalCard key={p.id} proposal={p} showDocument />
                ))}
              </div>
            </Panel>
          )}
          {SECTIONS.map((section) => {
            const items = data?.documents.filter((d) => d.reason === section.reason) ?? [];
            if (items.length === 0) return null;
            return (
              <Panel
                key={section.reason}
                icon={section.icon}
                title={`${section.title} (${items.length})`}
                description={section.description}
              >
                <ul className="divide-y" data-testid={`approvals-${section.reason}`}>
                  {items.map((d) => (
                    <DocumentRow key={d.id} doc={d} />
                  ))}
                </ul>
              </Panel>
            );
          })}
        </>
      )}
    </Page>
  );
}
