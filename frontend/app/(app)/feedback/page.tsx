import type { Metadata } from "next";
import { FeedbackScreen } from "@/components/feedback/feedback-screen";

export const metadata: Metadata = { title: "Feedback" };

export default function FeedbackPage() {
  return <FeedbackScreen />;
}
