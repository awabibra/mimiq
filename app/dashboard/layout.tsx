import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
