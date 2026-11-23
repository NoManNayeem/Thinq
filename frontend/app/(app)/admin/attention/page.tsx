import type { Metadata } from "next";
import { AttentionScreen } from "./attention-screen";

export const metadata: Metadata = { title: "Needs attention" };

export default function AttentionPage() {
  return <AttentionScreen />;
}
