-- The opt-in API derives operator identity from these columns only.
-- Keep the operator directory's contact details unavailable to this lookup.
GRANT SELECT (id, role, disabled)
ON TABLE public.firm_lawyers
TO service_role;
