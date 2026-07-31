const { Client } = await import("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await c.connect();
const { rows } = await c.query(
  "select id, firm_id, idempotency_key, created_at from publication_placement_claims where idempotency_key = 'same-key-different-firm' order by created_at",
);
console.log(rows);
await c.end();
