# Downtown owner-contact batch 001

This is a dry-run import manifest for six Downtown Toronto research records with both a named, first-party-confirmed owner or founding partner and a directly published business email.

It is deliberately separate from the firm-research payload and remains internal. It does not authorize database import, CRM sync, contact, or outreach. The owner-contact migration and its operator-only read projection must be merged and applied through the governed release path before any record can be written.

The manifest uses `sourceRecordKey` from the shared prospect ledger. It therefore adds contact evidence to existing firm identities rather than creating a second prospect list.
