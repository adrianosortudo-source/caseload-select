/**
 * Portal segment layout.
 * AdminShell already strips the admin sidebar for /portal routes.
 * The [firmId] nested layout provides the firm-branded chrome.
 * The login page is fully self-contained.
 */
export default function PortalSegmentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
