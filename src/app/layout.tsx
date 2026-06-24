import type { Metadata, Viewport } from "next";
import { Oxanium, Manrope } from "next/font/google";
import "./globals.css";
import AdminShell from "@/components/AdminShell";

const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-oxanium",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

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
    <html lang="en" className={`${oxanium.variable} ${manrope.variable}`}>
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
