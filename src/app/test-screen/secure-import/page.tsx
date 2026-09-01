import { notFound } from "next/navigation";
import SecureImportRoom from "@/components/portal/SecureImportRoom";
import SecureImportTrustGuide from "@/components/portal/SecureImportTrustGuide";

export default function SecureImportRenderedFixturePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="fixed inset-0 z-[100] overflow-y-auto bg-parchment">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <SecureImportRoom
          firmId="secure-import-rendered-fixture"
          readOnly
          enabled
          maxRows={2500}
          trustGuide={<SecureImportTrustGuide />}
        />
      </div>
    </main>
  );
}
