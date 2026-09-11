import type { Metadata } from "next";
import { VoiceContinuation } from "./VoiceContinuation";

export const metadata: Metadata = { title: "Continue your inquiry", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <VoiceContinuation />; }
