import type { Metadata, Viewport } from "next";
import "./globals.css";
import AdminShell from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "CaseLoad Select",
  description: "Sign Better Cases",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Lets the navy header colour the iOS / Android status bar when the lawyer
  // adds the portal to their home screen.
  themeColor: "#0D1520",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
