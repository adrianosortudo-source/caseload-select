-- Reconcile the service_role access inherited by migration-created tables.
-- The webhook inbox is immutable; UPDATE is needed only on the event key for
-- the replay path's SELECT ... FOR UPDATE lock.
REVOKE ALL PRIVILEGES ON TABLE public.agency_followup_provider_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.agency_followup_provider_events TO service_role;
GRANT UPDATE (provider_event_id) ON TABLE public.agency_followup_provider_events TO service_role;
