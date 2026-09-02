-- Production retained broader service_role privileges despite the original
-- table migration. Revoke the effective table ACL, then restore only the
-- server telemetry route's required read-and-append operations.
REVOKE ALL PRIVILEGES ON TABLE public.screen_funnel_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.screen_funnel_events TO service_role;
