# Protected migration database CA

`prod-ca-2021.crt` is a public certificate, not a credential. It was downloaded on 2026-09-27 from the SSL Configuration link displayed by the database settings page for project `ssxryjxifwiivghglqer`:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Exact downloaded SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

Subject and issuer: `Supabase Root 2021 CA`. Certificate validity ends 2031-04-26T10:56:53Z. `database-ca.mjs` verifies exact bytes, CA status, self-signature and current validity before use. `.gitattributes` preserves the downloaded bytes across platforms. Replace this file and its pin only through reviewed source when Supabase rotates its CA.

Supabase documents the `sslmode=verify-full` plus `sslrootcert` connection at https://supabase.com/docs/guides/database/psql and https://supabase.com/docs/guides/platform/ssl-enforcement. The protected workflows explicitly bind this module-relative absolute path to the selected database URL. They do not alter global trust or disable certificate/hostname verification. The absolute path remains valid when the CLI changes into staged migration directories.

The checkout SHA binds this helper and public CA. The release receipt remains restricted to migration SQL. No connection URL, private key or password belongs here or in a release artifact.
