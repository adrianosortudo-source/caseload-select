/**
 * Standalone layout for /widget/[firmId].
 *
 * Overrides the root layout  -  no Sidebar, no nav, no app chrome.
 * This makes the route safe for iframe embedding.
 */

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
