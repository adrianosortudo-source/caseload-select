# Downtown Toronto evidence batch I — 2026-09-11

## Purpose and operating boundary

This is an append-only, research-only reconciliation batch for the Downtown
Toronto 1–10 lawyer cohort. It records public observations made on 2026-09-11.
It does **not** create a firm, write a database record, change a CRM, contact a
firm, run a paid Local Falcon scan, deploy, merge, or make an advertising-spend
claim.

The records below remain evidence packets, not outreach-ready contacts. A
candidate is promoted only when every required identity, location, lawyer-count,
owner-contact, advertising, GBP, website/intake, and release gate is satisfied.

## Shared geography method

All address conclusions use the City of Toronto Downtown Plan (Secondary Plan
41), feature `OBJECTID 37`, obtained from the authoritative ArcGIS endpoint:

`https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/44/query?where=SECONDARY_PLAN_NUMBER%3D%2741%27&outFields=OBJECTID%2CSECONDARY_PLAN_NUMBER%2CSECONDARY_PLAN_NAME%2CSTATUS&returnGeometry=true&f=geojson&outSR=4326`

- Observation date: `2026-09-11`
- Full saved GeoJSON SHA-256: `3fedcfe1fdb5828ddec311d08c41447e671e6fba5ec7b6e3beea76421bc63a05`
- Canonically serialized geometry SHA-256:
  `b0a875087a25c3a4e24399d0fbf35da265b679c298fac57b7efd56ab2a110ed1`
- Coordinates were obtained through ArcGIS World Geocoder from the listed
  first-party office address, then point-in-polygon tested. The exact
  firm-address input is retained with each observation below.

## Evidence packets

### Scharff Nyland Chambers LLP — high-priority hold

- Shared identity: `firm_id FIRM-1C2XS2MW3NTR644JE1T3XVHFX2`; canonical domain
  `sncfamilylaw.com`.
- Address/location: `161 Bay St, 27th Floor, Toronto, ON M5J 2S1`;
  `(-79.378779, 43.646528)`; **inside**, high confidence.
- Lawyer count: three named partners on the current first-party roster; count
  confidence remains moderate until the whole-firm roster is independently
  accepted. Source: <https://sncfamilylaw.com/our-story/>.
- Owner/contact: Cindy L. Scharff is described as a founding partner and her
  directly published business address is `cscharff@sncfamilylaw.com`. Source:
  <https://sncfamilylaw.com/cindy-scharff/>.
- Observable advertising activity: Google Ads Transparency Center lists Canada
  text ads pointing to `sncfamilylaw.com`; creative
  `CR16536087611060518913` for advertiser *Scharff Nyland Chambers LLP* was
  last shown `2026-09-11`. Source:
  <https://adstransparency.google.com/advertiser/AR10032168469509701633/creative/CR16536087611060518913?region=CA>.
  This establishes activity only, not spend or investment.
- GBP/intake: the exact Google profile at this office was claimed with `0`
  reviews in the read-only Local Falcon lookup; the site visibly offers booking,
  phone, reception email, and a contact route. Sources:
  <https://www.google.com/maps/search/?api=1&query=Scharff+Nyland+Chambers+LLP&query_place_id=ChIJhxf3GPx6b4cRGQa0yH2ujUQ>
  and <https://sncfamilylaw.com/legal-disclaimer/>.
- **Hold reason:** obtain an independent, whole-firm three-lawyer acceptance
  before any strict-cohort promotion. No inference about firm performance,
  caseload, or revenue is made.

### Englobe Law LLP — evidence-complete except GBP/site opportunity

- Shared source reference: `gta-prospect-003-b003-05`; canonical domain
  `englobelaw.com`. A stable `firm_id` is not exposed in the retained offline
  crosswalk and must not be invented.
- Address/location: `100 King St W, Suite 5700, Toronto, ON M5X 1C7`;
  `(-79.381714, 43.648778)`; **inside**, high confidence.
- Lawyer/owner evidence: three-lawyer roster and founding-partner/direct-email
  evidence are retained in `downtown-owner-contact-001.dry-run.json` under this
  source record key.
- Observable advertising activity: Google Ads Transparency Center lists Canada
  text ads for advertiser *ENGLOBE LAW LLP* pointing to `englobelaw.com`;
  creative `CR15865875075669426177` was last shown `2026-09-11`. Source:
  <https://adstransparency.google.com/advertiser/AR03247230382285783041/creative/CR15865875075669426177?region=CA>.
  This is not a spend claim.
- **Hold reason:** direct GBP lookup timed out and this batch has no
  evidence-supported GBP or specific website/intake opportunity. Those fields
  remain unknown, not negative.

### Zubas Flett Liberatore Law LLP — evidence-complete except GBP/site opportunity

- Shared source reference: `gta-prospect-005-b005-13`; canonical domain
  `employment-lawyers.ca`. A stable `firm_id` is not exposed in the retained
  offline crosswalk and must not be invented.
- Address/location: `150 Beverley St, Unit 1, Toronto, ON M5T 1Y5`;
  `(-79.394551, 43.654443)`; **inside**, high confidence.
- Lawyer/owner evidence: current research records a nine-lawyer first-party
  roster and founder/direct-email evidence for Loreta Zubas. Source:
  <https://www.employment-lawyers.ca/contact/>.
- Observable advertising activity: Google Ads Transparency Center lists Canada
  text ads pointing to `employment-lawyers.ca`; advertiser *Ted Flett
  Professional Corporation*, creative `CR01375482758515654657`, was last shown
  `2026-09-11`. Source:
  <https://adstransparency.google.com/advertiser/AR02488681107034210305/creative/CR01375482758515654657?region=CA>.
  The domain linkage is observed; the advertiser-to-firm relationship must not
  be broadened beyond this record. This is not a spend claim.
- **Hold reason:** no direct current GBP evidence and no specific
  website/intake opportunity are supported in this batch.

### Baker & Company — exclude from advertising-qualified queue

- Shared source reference: `gta-prospect-002-b002-11`; canonical domain
  `bakerlawyers.com`.
- Address/location: `130 Adelaide St W, Suite 2101, Toronto, ON M5H 3P5`;
  `(-79.383812, 43.649691)`; **inside**, high confidence.
- GBP context: exact claimed profile returned `4.6` rating and `48` reviews;
  this is not a supported weak-GBP finding.
- Advertising check: the Google Ads Transparency Center returned “No ads found”
  for `bakerlawyers.com` in Canada at observation time. This means no activity
  was observed through that source; it does not prove no advertising exists.
- **Disposition:** excluded from the advertising-qualified queue unless a
  separate, direct advertising source is observed.

### Naymark LLP — hold, advertising unobserved

- Shared source reference: `gta-prospect-009-b009-01`; canonical domain
  `naymarklaw.com`.
- Address/location: `30 Duncan St, 5th Floor, Toronto, ON M5V 2C3`;
  `(-79.389243, 43.648944)`; **inside**, high confidence.
- GBP context: exact claimed profile returned `5.0` rating and `2` reviews.
  Low review volume alone is not a weak-GBP finding.
- Advertising check: the Google Ads Transparency Center returned “No ads found”
  for `naymarklaw.com` in Canada at observation time. This is an unknown/
  unobserved status for the advertising gate, not proof of absence.
- **Disposition:** hold pending direct advertising and evidence-supported
  website/GBP opportunity observations.

### Hines Legal PC — excluded by geography

- Shared source reference: `gta-prospect-006-b006-17`; canonical domain
  `hineslegal.ca`.
- Address/location: `80 Atlantic Ave, 4th Floor, Toronto, ON M6K 1X9`;
  `(-79.421032, 43.638759)`; **outside**, high confidence, approximately
  `1.58 km` from the Plan 41 boundary.
- **Disposition:** excluded from the strict Downtown cohort. This corrects the
  earlier preliminary Map 6A assertion; it is not a borderline/manual-review
  case.

## Reconciliation outcome

The batch adds three independently current, public advertising observations and
six authoritative Downtown boundary outcomes. It promotes no new firm to the
strict cohort: the unresolved gate is either whole-firm lawyer-count acceptance
or a direct, evidence-supported GBP and website/intake opportunity. The next
safe action is to attach these observations to the existing firm identities via
the governed append-only projection; it must not create a third list or import
records before the live service-role preflight is available.
