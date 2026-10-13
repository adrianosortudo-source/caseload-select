import { resolve } from "node:path";

const repoRoot = process.cwd();
const root = resolve(repoRoot, "scripts/agency-followup-rendered");
export default {
  root,
  resolve: {
    alias: [
      { find: "@", replacement: resolve(repoRoot, "src") },
      { find: "next/navigation", replacement: resolve(repoRoot, "scripts/agency-followup-rendered/navigation-shim.ts") },
    ],
  },
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
};
