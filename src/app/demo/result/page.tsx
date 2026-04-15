/**
 * /demo/result?session={sessionId}
 *
 * Demo portal view — shows what the lawyer sees after intake completes.
 * Access-gated by session ID in the URL (no login required for demo).
 */

import { supabase } from "@/lib/supabase";
import DemoPortalResult from "./DemoPortalResult";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ session?: string }>;
}

export default async function DemoResultPage({ searchParams }: Props) {
  const { session: sessionId } = await searchParams;

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Session ID required</h1>
          <p className="text-sm text-gray-500 mb-6">
            This page is accessible via the link generated at the end of an intake session.
          </p>
          <Link href="/demo"
            className="inline-block px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: "#1B3A6B" }}>
            ← Back to Demo
          </Link>
        </div>
      </div>
    );
  }

  const { data: session, error } = await supabase
    .from("intake_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Session not found</h1>
          <p className="text-sm text-gray-500 mb-6">
            This session may have expired or the ID is invalid. Complete a new intake to get a fresh result link.
          </p>
          <Link href="/demo"
            className="inline-block px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: "#1B3A6B" }}>
            ← Try the Demo
          </Link>
        </div>
      </div>
    );
  }

  return <DemoPortalResult session={session} />;
}
