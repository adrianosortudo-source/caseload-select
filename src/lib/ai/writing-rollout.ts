import "server-only";
import { publicToolProvider } from "./public-tool-rollout";

const settings = {
  why: ["WHY_YOUR_FIRM_ASSIST_PROVIDER", "WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT"],
  best: ["DESIRED_CLIENT_PROVIDER", "DESIRED_CLIENT_OPENAI_PERCENT"],
} as const;

export function writingProvider(tool: keyof typeof settings, identity?: string) {
  const [provider, percent] = settings[tool];
  return publicToolProvider(provider, percent, identity);
}
