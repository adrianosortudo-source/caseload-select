import type { Metadata } from "next";
import { ExampleBlueprint } from "@/components/desired-client/ExampleBlueprint";
import "@/components/desired-client/desired-client.css";

export const metadata: Metadata = {
  title: "Fictional Desired Client Blueprint | CaseLoad Select",
  description: "An illustrative, print-ready HTML Desired Client Blueprint for a fictional law firm.",
  robots: { index: false, follow: false },
};

export default function DesiredClientExamplePage() {
  return (
    <div className="dc-route dc-route--example">
      <header className="dc-site-header">
        <nav aria-label="CaseLoad Select">
          <a href="https://caseloadselect.ca">CaseLoad Select</a>
          <a href="/tools/desired-client-matter">Back to the tool</a>
        </nav>
      </header>
      <main className="dc-route-main">
        <div className="dc-app dc-example-page">
          <ExampleBlueprint standalone />
        </div>
      </main>
    </div>
  );
}
