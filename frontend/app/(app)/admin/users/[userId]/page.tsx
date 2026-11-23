import type { Metadata } from "next";
import { UserDetailScreen } from "./user-detail-screen";

export const metadata: Metadata = { title: "User" };

export default function UserDetailPage() {
  return <UserDetailScreen />;
}
