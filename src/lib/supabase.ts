/**
 * Legacy path. Re-exports the service-role admin client as `supabase`.
 *
 * Keeps existing server-side `import { supabase } from "@/lib/supabase"` call
 * sites working without a bulk rename. Importing this from any client bundle
 * throws at build time, because supabase-admin.ts carries `import 'server-only'`.
 *
 * New server-side code should import directly from "@/lib/supabase-admin".
 * Browser-side code must never import either path; use API routes.
 */
export { supabaseAdmin as supabase } from "./supabase-admin";
