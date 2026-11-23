import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatScreen } from "@/components/chat/chat-screen";

export const metadata: Metadata = { title: "Ask Thinq" };

export default function ChatPage() {
  return (
    <Suspense>
      <ChatScreen />
    </Suspense>
  );
}
