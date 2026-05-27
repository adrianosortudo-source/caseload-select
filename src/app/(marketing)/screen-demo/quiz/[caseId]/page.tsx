import { notFound } from "next/navigation";
import DemoNav from "../../_components/DemoNav";
import ScreenQuiz from "../../_components/ScreenQuiz";
import { getCase, SAMPLE_CASES } from "../../_data/cases";

interface PageProps {
  params: Promise<{ caseId: string }>;
}

export function generateStaticParams() {
  return SAMPLE_CASES.map((c) => ({ caseId: c.id }));
}

/**
 * /screen-demo/quiz/[caseId]
 *
 * Mounts the ScreenQuiz with the selected case fixture. The case ID comes
 * from the URL; if unknown, 404. The lawyer arrives here from the picker,
 * walks through five questions, hits the email gate, and sees the report.
 *
 * All state lives client-side in ScreenQuiz; this page is just the mount.
 */
export default async function ScreenDemoQuizPage({ params }: PageProps) {
  const { caseId } = await params;
  const caseFixture = getCase(caseId);
  if (!caseFixture) notFound();

  return (
    <>
      <DemoNav />
      <main className="cls-quiz-main">
        <ScreenQuiz caseFixture={caseFixture} />
      </main>

      <style>{`
        .cls-quiz-main {
          background: var(--parchment);
          min-height: calc(100vh - 72px);
          padding: var(--sp-7) var(--sp-4) var(--sp-9);
        }
      `}</style>
    </>
  );
}
