import type { Metadata } from "next";
import { GroupDetailScreen } from "./group-detail-screen";

export const metadata: Metadata = { title: "Group" };

export default function GroupDetailPage() {
  return <GroupDetailScreen />;
}
