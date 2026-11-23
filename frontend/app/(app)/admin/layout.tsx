import { AdminGate } from "@/components/shell/admin-gate";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminGate>{children}</AdminGate>;
}
