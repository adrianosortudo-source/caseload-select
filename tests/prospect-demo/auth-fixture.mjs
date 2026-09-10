import { createServer } from "node:http";

// This server supplies only one fictional membership to the unmodified app
// auth guard. It cannot proxy requests or read a real database or credential.
const lawyerId = "00000000-0000-4000-8000-000000000263";
const firmId = "00000000-0000-4000-8000-000000000264";
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:3110");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && url.pathname === "/ready") {
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  if (
    request.method === "GET" && url.pathname === "/rest/v1/firm_lawyers" &&
    url.searchParams.get("select") === "id" &&
    url.searchParams.get("id") === `eq.${lawyerId}` &&
    url.searchParams.get("firm_id") === `eq.${firmId}` &&
    url.searchParams.get("role") === "eq.operator" &&
    url.searchParams.get("disabled") === "eq.false"
  ) {
    const objectResponse = request.headers.accept?.includes("application/vnd.pgrst.object+json");
    response.end(JSON.stringify(objectResponse ? { id: lawyerId } : [{ id: lawyerId }]));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "No fixture for this request." }));
});
server.listen(3110, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
