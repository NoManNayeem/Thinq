import type { Metadata } from "next";
import { GroupsScreen } from "./groups-screen";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return <GroupsScreen />;
}
