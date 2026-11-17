import { handleScreenExtraction } from "@/lib/screen-extraction-handler";

// The original demo and operational browser widgets disclose Gemini and share this URL.
export async function POST(req: Request) {
  return handleScreenExtraction(req, "gemini");
}
