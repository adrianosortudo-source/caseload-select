import { getOperatorSession } from "@/lib/portal-auth";
import { redirect } from "next/navigation";
import { VoiceScreenQueue } from "./VoiceScreenQueue";
export default async function Page() {
  if (!await getOperatorSession()) redirect("/operator/login");
  return <VoiceScreenQueue />;
}
