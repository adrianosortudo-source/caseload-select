-- The opt-in API derives operator identity from these columns only. The
-- shared service_role has broader table access for other server handlers, so
-- the opt-in lookup enforces its narrow projection in application code.
GRANT SELECT (id, role, disabled)
ON TABLE public.firm_lawyers
TO service_role;
