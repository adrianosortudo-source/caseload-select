const DB_URL = process.env.DIRECT_DATABASE_URL;
console.log("Node version:", process.version);
console.log("DB_URL:", DB_URL);

const { Client } = await import("pg");
const connA = new Client({ connectionString: DB_URL });
const connB = new Client({ connectionString: DB_URL });
try {
  await connA.connect();
  console.log("connA connected OK");
  await connB.connect();
  console.log("connB connected OK");
  const r = await connA.query("select 1 as one");
  console.log("query result:", r.rows);
} catch (err) {
  console.error("REPRO ERROR:", err);
  console.error("STACK:", err.stack);
} finally {
  try { await connA.end(); } catch {}
  try { await connB.end(); } catch {}
}
