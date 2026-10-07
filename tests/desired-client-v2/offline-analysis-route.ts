import { build } from "esbuild";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextRequest } from "next/server";

/** Test-only loopback HTTP server: actual route + analysis service, stubbed SDK
 * and rate-limit store. No live provider, Redis or database capability is loaded. */
export async function startOfflineAnalysisRoute(providerOutput: unknown, outputDir: string) {
 const bundlePath = path.join(outputDir, "offline-analysis-route.cjs");
 await build({
  stdin: {
   contents: 'export { GET, POST } from "./src/app/api/tools/desired-client-matter/analyze/route"; export { offlineProviderCalls } from "@google/generative-ai";',
   resolveDir: process.cwd(), loader: "ts",
  },
  outfile: bundlePath, bundle: true, platform: "node", format: "cjs", external: ["next/server"], logLevel: "silent",
  plugins: [{ name: "offline-boundaries", setup(builder) {
   builder.onResolve({ filter: new RegExp("^(?:@google/generative-ai|@/lib/rate-limit|server-only)$") }, args => ({ path: args.path, namespace: "offline" }));
   builder.onLoad({ filter: /.*/, namespace: "offline" }, args => ({ loader: "js", contents:
    args.path === "server-only" ? "" : args.path === "@google/generative-ai" ?
     'export const SchemaType={STRING:"string",OBJECT:"object",ARRAY:"array",INTEGER:"integer",NUMBER:"number",BOOLEAN:"boolean"}; let calls=0; export const offlineProviderCalls=()=>calls; export class GoogleGenerativeAI { getGenerativeModel(){ return {generateContent:async()=>{calls++;return {response:{text:()=>JSON.stringify(' + JSON.stringify(providerOutput) + ')}};}};} }' :
     'let used=0; export const checkRateLimit=async()=>({ok:true,active:true,remaining:19,reset:Date.now()+60000,limit:20}); export const ipFromRequest=()=>"127.0.0.1"; export const rateLimitHeaders=()=>({}); export const releaseDesiredClientProviderRun=async()=>{}; export const reserveDesiredClientProviderCall=async(input)=>{if(input.expectedCallsUsed!==used)return {status:"sequence_conflict",callsUsed:used};if(used>=input.limit)return {status:"exhausted",callsUsed:used};return {status:"reserved",callsUsed:++used};};',
   }));
  } }],
 });
 const env = { DESIRED_CLIENT_AI_ENABLED: "true", GOOGLE_AI_API_KEY: "offline-stub", GEMINI_API_KEY: "", UPSTASH_REDIS_REST_URL: "https://offline.invalid", UPSTASH_REDIS_REST_TOKEN: "offline-stub", VERCEL_ENV: "preview" };
 const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
 Object.assign(process.env, env);
 const route = createRequire(path.join(process.cwd(), "package.json"))(bundlePath) as { GET: () => Promise<Response>; POST: (request: NextRequest) => Promise<Response>; offlineProviderCalls: () => number };
 const server = createServer(async (incoming, outgoing) => {
  try {
   const chunks: Buffer[] = [];
   for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
   const headers = new Headers();
   for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
   const url = "http://localhost:3301/api/tools/desired-client-matter/analyze";
   const response = incoming.method === "GET" ? await route.GET() : await route.POST(new Request(url, { method: "POST", headers, body: Buffer.concat(chunks).toString() }) as NextRequest);
   outgoing.writeHead(response.status, Object.fromEntries(response.headers));
   outgoing.end(await response.text());
  } catch {
   outgoing.writeHead(500); outgoing.end("Offline route harness failed");
  }
 });
 await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
 const address = server.address();
 if (!address || typeof address === "string") throw new Error("Offline route address missing");
 return {
  url: "http://127.0.0.1:" + address.port + "/api/tools/desired-client-matter/analyze",
  providerCalls: route.offlineProviderCalls,
  close: async () => {
   await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
   for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  },
 };
}
