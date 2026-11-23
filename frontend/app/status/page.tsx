import type { Metadata } from "next";
import { StatusScreen } from "./status-screen";

export const metadata: Metadata = { title: "System status" };

export default function StatusPage() {
  return <StatusScreen />;
}
