# GTA owner-contact evidence contract

This companion ledger records public evidence of the person who should be contacted about a GTA prospect. It is separate from the core GTA firm-research import, which remains free of contact, CRM, messaging, and outreach fields.

An entry requires the person's name, role, source URL, observation date, and confidence. `confirmed_owner` means the cited evidence establishes current ownership or control. `leadership_only` records a public leadership indication such as a founder title without treating it as current ownership.

A `direct_owner_email` requires confirmed ownership plus a publicly published email, its source URL, and observation date. Email-pattern guesses are not valid evidence. A shared firm inbox is retained as `firm_general_email` and does not satisfy the direct-owner-email requirement. Missing contact information is recorded as `unavailable`.

The database table is private, append-only, RLS-protected, and only exposed through a narrow service-role operator summary. It is research evidence, not an authorization to contact anyone.
