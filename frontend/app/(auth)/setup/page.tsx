import type { Metadata } from "next";
import { SetupScreen } from "./setup-screen";

export const metadata: Metadata = { title: "Set up Thinq" };

export default function SetupPage() {
  return <SetupScreen />;
}
