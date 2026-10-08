import Image from "next/image";
import type { Metadata } from "next";
import DesiredClientTool from "@/components/desired-client/DesiredClientTool";

export const metadata: Metadata = {
  title: "Desired Client | CaseLoad Select",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ embed?: string }>;
}

export default async function DesiredClientMatterPage({ searchParams }: PageProps) {
  const { embed } = await searchParams;
  const embedded = embed === "1";

  return (
    <div className={`dc-route${embedded ? " dc-route--embedded" : ""}`}>
      {!embedded && (
        <header className="dc-site-header">
          <nav aria-label="CaseLoad Select">
            <div className="dc-identity"><a href="https://caseloadselect.ca" aria-label="CaseLoad Select home"><Image className="dc-brand-logo" src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png" alt="CaseLoad Select. Sign better cases." width={280} height={55} unoptimized priority /></a><span className="dc-tool-tag">Desired Client</span></div>
            <a href="https://caseloadselect.ca/tools.html">Back to tools</a>
          </nav>
        </header>
      )}
      <main className="dc-route-main">
        <DesiredClientTool embedded={embedded} />
      </main>
    </div>
  );
}
