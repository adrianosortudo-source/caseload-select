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
            <a href="https://caseloadselect.ca">CaseLoad Select</a>
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
