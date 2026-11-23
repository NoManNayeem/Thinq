import type { Metadata } from "next";
import { DocumentScreen } from "./document-screen";

export const metadata: Metadata = { title: "Document" };

export default function DocumentPage() {
  return <DocumentScreen />;
}
