import type { Metadata } from "next";
import { KnowledgeScreen } from "@/components/knowledge/knowledge-screen";

export const metadata: Metadata = { title: "Knowledge graph" };

export default function KnowledgePage() {
  return <KnowledgeScreen />;
}
