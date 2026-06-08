import type { Metadata } from "next";
import { AuthListener } from "@/components/AuthListener";
import "./globals.css";

export const metadata: Metadata = {
  title: "MimiQ — Vocal Mixing Intelligence",
  description:
    "Analyze raw vocals and generate exact, personalized mixing chains for bedroom producers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthListener />
        {children}
      </body>
    </html>
  );
}
