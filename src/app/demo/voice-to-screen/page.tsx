import type { Metadata } from "next";
import { VoiceScreenDemo } from "./VoiceScreenDemo";

export const metadata: Metadata = {
  title: "Voice to Screen | CaseLoad Select demo",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <VoiceScreenDemo />;
}
