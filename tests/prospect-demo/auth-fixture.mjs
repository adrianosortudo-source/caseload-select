import { createServer } from "node:http";

// This server supplies only one fictional membership to the unmodified app
// auth guard. It cannot proxy requests or read a real database or credential.
const lawyerId = "00000000-0000-4000-8000-000000000263";
const firmId = "00000000-0000-4000-8000-000000000264";
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:3110");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && url.pathname === "/ready") {
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/rest/v1/rpc/revalidate_operator_membership_v1") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const args = JSON.parse(body);
    if (
      args.p_lawyer_id !== lawyerId || args.p_firm_id !== firmId ||
      typeof args.p_record_sign_in !== "boolean"
    ) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "Unexpected operator membership arguments." }));
      return;
    }
    // PostgreSQL uuid scalar RPCs are returned as JSON strings by PostgREST.
    response.end(JSON.stringify(lawyerId));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "No fixture for this request." }));
});
server.listen(3110, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
