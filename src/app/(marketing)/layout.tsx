import type { Metadata } from "next";
import "./styles/tokens.css";
import "./styles/marketing.css";
import RevealOnScroll from "./components/RevealOnScroll";

export const metadata: Metadata = {
  title: "CaseLoad Select · Sign Better Cases",
  description:
    "Most Ontario firms don't have a lead generation problem. They have a lead selection problem. CaseLoad Select is the operator-led system that ranks every inquiry before it reaches you.",
  openGraph: {
    title: "CaseLoad Select · Sign Better Cases",
    description:
      "Every case that reaches you arrives ranked. You know which ones to activate before you make a single call.",
    type: "website",
    locale: "en_CA",
  },
  // The marketing pages are a metadata root of their own, so they do not pick up
  // the app/icon.png file convention the console inherits. Point at the same
  // served assets so the CaseLoad mark is the favicon across the whole domain.
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

/**
 * Marketing route group layout
 *
 * Independent from the admin app's root layout (no AdminShell, no Tailwind
 * leak). The `cls-marketing` body class scopes all marketing tokens and
 * styles so the marketing CSS never touches the admin app's UI, even if
 * they share the same Next.js app.
 *
 * `RevealOnScroll` mounts once and attaches a single IntersectionObserver
 * to every `.reveal` element on the page.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cls-marketing">
      <RevealOnScroll />
      {children}
    </div>
  );
}
