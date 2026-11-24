import type { Metadata } from "next";
import { QualityScreen } from "@/components/admin/quality-screen";

export const metadata: Metadata = { title: "Answer quality" };

export default function QualityPage() {
  return <QualityScreen />;
}
