import type { Metadata } from "next";
import { VoiceScreenTestWorkspace } from "../VoiceScreenTestWorkspace";
export const metadata: Metadata = { title: "Caller widget | Independent testing", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <VoiceScreenTestWorkspace initialSegment="widget" />; }
