import { screenTextProvider } from "@/lib/ai/intake-generation";
import { handleScreenExtraction } from "@/lib/screen-extraction-handler";

export async function POST(req: Request) {
  return handleScreenExtraction(req, screenTextProvider());
}
