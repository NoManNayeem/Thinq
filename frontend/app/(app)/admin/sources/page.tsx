import type { Metadata } from "next";
import { SourcesScreen } from "@/components/admin/sources-screen";

export const metadata: Metadata = { title: "Sources and sync" };

export default function SourcesPage() {
  return <SourcesScreen />;
}
