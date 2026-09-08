import type { ProspectOwnerCohortUpdate } from "./prospect-intelligence";

// Generated from a Luna-approved owner-cohort QA dataset; do not hand edit.
export const BRAZILIAN_OWNER_COHORT_SOURCE_MANIFEST = {
  "rows": 13,
  "sha256": "0CC15CCB59FD31FFC3EA70C744AF5163EB06CB81EEE7371F1F8F1ABDEDE900BB",
  "sourceFile": "LANE_B_FINAL_PORTAL_INGESTION_2026-09-07.jsonl"
} as const;

export const BRAZILIAN_OWNER_COHORT_UPDATES = [
  {
    "operation": "update",
    "id": "thiago-machado",
    "name": "Thiago Machado",
    "firm": "Machado Law – Refugee & Immigration",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Machado Law – Refugee & Immigration",
    "suppression": null,
    "evidence": "B2",
    "website": "https://www.machadolaw.ca/",
    "email": "info@machadolaw.ca",
    "phone": "647-488-1288",
    "sources": [
      "https://www.machadolaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
    ],
    "unknowns": [
      "A prior personal email value was not retained because the cited current first-party page publishes only info@machadolaw.ca."
    ],
    "domains": [
      "https://www.machadolaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
    ],
    "sourceRecordId": "BAO-P-000006",
    "publicContact": {
      "email": "info@machadolaw.ca",
      "phone": "647-488-1288",
      "website": "https://www.machadolaw.ca/",
      "bioUrl": "https://www.machadolaw.ca/",
      "contactSourceUrl": "https://www.machadolaw.ca/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F",
      "provenance": [
        "baseline_68 plus targeted first-party ownership verification; current page publishes firm generic inbox, not a personal email"
      ],
      "lsoNumber": "93888F",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000006",
    "canonicalFirmId": "firm:machado-law-refugee-immigration",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party Machado Law page identifies Thiago as Principal Lawyer and Founder and states he founded Machado Law.",
      "https://www.machadolaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.machadolaw.ca/",
        "host": "machadolaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.machadolaw.ca/",
        "sourceUrl": "https://www.machadolaw.ca/",
        "evidenceIds": [
          "https://www.machadolaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "info@machadolaw.ca",
        "sourceUrl": "https://www.machadolaw.ca/",
        "evidenceIds": [
          "https://www.machadolaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "647-488-1288",
        "sourceUrl": "https://www.machadolaw.ca/",
        "evidenceIds": [
          "https://www.machadolaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=93888F"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "A prior personal email value was not retained because the cited current first-party page publishes only info@machadolaw.ca."
    ]
  },
  {
    "operation": "update",
    "id": "eduardo-oliveira",
    "name": "Eduardo Oliveira",
    "firm": "Flow Law Professional Corporation",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Flow Law Professional Corporation",
    "suppression": null,
    "evidence": "B2",
    "website": "https://flowlaw.ca/",
    "email": "eduardo@flowlaw.ca",
    "phone": "416-644-4673",
    "sources": [
      "https://flowlaw.ca/",
      "https://flowlaw.ca/eduardo-oliveira/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
    ],
    "unknowns": [],
    "domains": [
      "https://flowlaw.ca/",
      "https://flowlaw.ca/eduardo-oliveira/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
    ],
    "sourceRecordId": "BAO-P-000011",
    "publicContact": {
      "email": "eduardo@flowlaw.ca",
      "phone": "416-644-4673",
      "website": "https://flowlaw.ca/",
      "bioUrl": "https://flowlaw.ca/eduardo-oliveira/",
      "contactSourceUrl": "https://flowlaw.ca/eduardo-oliveira/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H",
      "provenance": [
        "baseline_68 plus LSO verification"
      ],
      "lsoNumber": "85573H",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000011",
    "canonicalFirmId": "firm:flow-law-professional-corporation",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "Existing first-party owner/operator evidence retained; LSO current private-practice record aligns.",
      "https://flowlaw.ca/",
      "https://flowlaw.ca/eduardo-oliveira/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://flowlaw.ca/",
        "host": "flowlaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://flowlaw.ca/eduardo-oliveira/",
        "host": "flowlaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://flowlaw.ca/",
        "sourceUrl": "https://flowlaw.ca/",
        "evidenceIds": [
          "https://flowlaw.ca/",
          "https://flowlaw.ca/eduardo-oliveira/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "eduardo@flowlaw.ca",
        "sourceUrl": "https://flowlaw.ca/eduardo-oliveira/",
        "evidenceIds": [
          "https://flowlaw.ca/",
          "https://flowlaw.ca/eduardo-oliveira/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-644-4673",
        "sourceUrl": "https://flowlaw.ca/eduardo-oliveira/",
        "evidenceIds": [
          "https://flowlaw.ca/",
          "https://flowlaw.ca/eduardo-oliveira/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=85573H"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "update",
    "id": "david-baptista-dos-reis",
    "name": "David Baptista dos Reis",
    "firm": "LD Law LLP",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "LD Law LLP",
    "suppression": null,
    "evidence": "B4",
    "website": "https://www.ldlaw.ca/",
    "phone": "416-747-9900",
    "sources": [
      "https://www.ldlaw.ca/david-baptista-dos-reis/",
      "https://www.ldlaw.ca/about/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L"
    ],
    "unknowns": [
      "No individual public email observed in reviewed source."
    ],
    "domains": [
      "https://www.ldlaw.ca/david-baptista-dos-reis/",
      "https://www.ldlaw.ca/about/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L"
    ],
    "sourceRecordId": "BAO-P-000015",
    "publicContact": {
      "email": null,
      "phone": "416-747-9900",
      "website": "https://www.ldlaw.ca/",
      "bioUrl": "https://www.ldlaw.ca/david-baptista-dos-reis/",
      "contactSourceUrl": "https://www.ldlaw.ca/david-baptista-dos-reis/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L",
      "provenance": [
        "baseline_68 plus targeted first-party ownership verification"
      ],
      "lsoNumber": "60412L",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000015",
    "canonicalFirmId": "firm:ld-law-llp",
    "ownerAuthority": "O2",
    "ownerAuthorityEvidence": [
      "First-party LD Law page explicitly identifies David as a founding partner of LD Law LLP.",
      "https://www.ldlaw.ca/david-baptista-dos-reis/",
      "https://www.ldlaw.ca/about/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.ldlaw.ca/",
        "host": "ldlaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.ldlaw.ca/david-baptista-dos-reis/",
        "host": "ldlaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.ldlaw.ca/about/",
        "host": "ldlaw.ca",
        "state": "unresolved",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.ldlaw.ca/",
        "sourceUrl": "https://www.ldlaw.ca/",
        "evidenceIds": [
          "https://www.ldlaw.ca/david-baptista-dos-reis/",
          "https://www.ldlaw.ca/about/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-747-9900",
        "sourceUrl": "https://www.ldlaw.ca/david-baptista-dos-reis/",
        "evidenceIds": [
          "https://www.ldlaw.ca/david-baptista-dos-reis/",
          "https://www.ldlaw.ca/about/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=60412L"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "No individual public email observed in reviewed source."
    ]
  },
  {
    "operation": "update",
    "id": "carlos-martins",
    "name": "Carlos Martins",
    "firm": "WeirFoulds LLP",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "WeirFoulds LLP",
    "suppression": null,
    "evidence": "B4",
    "website": "https://www.weirfoulds.com/",
    "email": "cmartins@weirfoulds.com",
    "phone": "416-619-6284",
    "sources": [
      "https://www.weirfoulds.com/people/carlos-martins",
      "https://www.weirfoulds.com/pdf-profile?id=14893",
      "https://www.weirfoulds.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
    ],
    "unknowns": [],
    "domains": [
      "https://www.weirfoulds.com/people/carlos-martins",
      "https://www.weirfoulds.com/pdf-profile?id=14893",
      "https://www.weirfoulds.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
    ],
    "sourceRecordId": "BAO-P-000017",
    "publicContact": {
      "email": "cmartins@weirfoulds.com",
      "phone": "416-619-6284",
      "website": "https://www.weirfoulds.com/",
      "bioUrl": "https://www.weirfoulds.com/people/carlos-martins",
      "contactSourceUrl": "https://www.weirfoulds.com/people/carlos-martins",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B",
      "provenance": [
        "baseline_68 plus targeted first-party ownership and contact verification"
      ],
      "lsoNumber": "37916B",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000017",
    "canonicalFirmId": "firm:weirfoulds-llp",
    "ownerAuthority": "O2",
    "ownerAuthorityEvidence": [
      "First-party WeirFoulds profile identifies Carlos as current Partner and a prior founding partner of Bersenas Jacobsen; current partner authority is explicit.",
      "https://www.weirfoulds.com/people/carlos-martins",
      "https://www.weirfoulds.com/pdf-profile?id=14893",
      "https://www.weirfoulds.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.weirfoulds.com/",
        "host": "weirfoulds.com",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.weirfoulds.com/people/carlos-martins",
        "host": "weirfoulds.com",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.weirfoulds.com/pdf-profile?id=14893",
        "host": "weirfoulds.com",
        "state": "unresolved",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.weirfoulds.com/",
        "sourceUrl": "https://www.weirfoulds.com/",
        "evidenceIds": [
          "https://www.weirfoulds.com/people/carlos-martins",
          "https://www.weirfoulds.com/pdf-profile?id=14893",
          "https://www.weirfoulds.com/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "cmartins@weirfoulds.com",
        "sourceUrl": "https://www.weirfoulds.com/people/carlos-martins",
        "evidenceIds": [
          "https://www.weirfoulds.com/people/carlos-martins",
          "https://www.weirfoulds.com/pdf-profile?id=14893",
          "https://www.weirfoulds.com/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-619-6284",
        "sourceUrl": "https://www.weirfoulds.com/people/carlos-martins",
        "evidenceIds": [
          "https://www.weirfoulds.com/people/carlos-martins",
          "https://www.weirfoulds.com/pdf-profile?id=14893",
          "https://www.weirfoulds.com/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=37916B"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "update",
    "id": "michelle-jorge",
    "name": "Michelle Jorge",
    "firm": "Jewell Radimisis Jorge LLP",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Jewell Radimisis Jorge LLP",
    "suppression": null,
    "evidence": "B4",
    "website": "https://www.jrjlaw.com/",
    "phone": "844-342-5575",
    "sources": [
      "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
      "https://www.jrjlaw.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G"
    ],
    "unknowns": [
      "No individual public email observed in reviewed source."
    ],
    "domains": [
      "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
      "https://www.jrjlaw.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G"
    ],
    "sourceRecordId": "BAO-P-000028",
    "publicContact": {
      "email": null,
      "phone": "844-342-5575",
      "website": "https://www.jrjlaw.com/",
      "bioUrl": "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
      "contactSourceUrl": "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G",
      "provenance": [
        "baseline_68 plus targeted first-party ownership verification"
      ],
      "lsoNumber": "49813G",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000028",
    "canonicalFirmId": "firm:jewell-radimisis-jorge-llp",
    "ownerAuthority": "O2",
    "ownerAuthorityEvidence": [
      "First-party JRJ page lists Michelle F. Jorge as Partner; LSO lists current Toronto private practice.",
      "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
      "https://www.jrjlaw.com/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.jrjlaw.com/",
        "host": "jrjlaw.com",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
        "host": "jrjlaw.com",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.jrjlaw.com/",
        "sourceUrl": "https://www.jrjlaw.com/",
        "evidenceIds": [
          "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
          "https://www.jrjlaw.com/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "844-342-5575",
        "sourceUrl": "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
        "evidenceIds": [
          "https://www.jrjlaw.com/our-lawyers/michelle-f-jorge-ll-b-ba-hons-/",
          "https://www.jrjlaw.com/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=49813G"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "No individual public email observed in reviewed source."
    ]
  },
  {
    "operation": "add",
    "id": "benjamin-marcos",
    "name": "Benjamin Marcos",
    "firm": "Marcos Associates",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Marcos Associates",
    "suppression": null,
    "evidence": "B4",
    "website": "https://marcosassociates.ca/",
    "email": "bmarcos@marcosassociates.ca",
    "phone": "416-537-3151",
    "sources": [
      "https://marcosassociates.ca/who-we-are/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
    ],
    "unknowns": [],
    "domains": [
      "https://marcosassociates.ca/who-we-are/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
    ],
    "sourceRecordId": "BAO-P-000032",
    "publicContact": {
      "email": "bmarcos@marcosassociates.ca",
      "phone": "416-537-3151",
      "website": "https://marcosassociates.ca/",
      "bioUrl": "https://marcosassociates.ca/who-we-are/",
      "contactSourceUrl": "https://marcosassociates.ca/who-we-are/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M",
      "provenance": [
        "baseline_68 plus saturation challenge plus live LSO verification"
      ],
      "lsoNumber": "58357M",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000032",
    "canonicalFirmId": "firm:marcos-associates",
    "ownerAuthority": "O2",
    "ownerAuthorityEvidence": [
      "First-party page identifies Benjamin as Managing Partner and Principal; LSO lists current private practice and both Marcos business names.",
      "https://marcosassociates.ca/who-we-are/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://marcosassociates.ca/",
        "host": "marcosassociates.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://marcosassociates.ca/who-we-are/",
        "host": "marcosassociates.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://marcosassociates.ca/",
        "sourceUrl": "https://marcosassociates.ca/",
        "evidenceIds": [
          "https://marcosassociates.ca/who-we-are/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "bmarcos@marcosassociates.ca",
        "sourceUrl": "https://marcosassociates.ca/who-we-are/",
        "evidenceIds": [
          "https://marcosassociates.ca/who-we-are/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-537-3151",
        "sourceUrl": "https://marcosassociates.ca/who-we-are/",
        "evidenceIds": [
          "https://marcosassociates.ca/who-we-are/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=58357M"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "add",
    "id": "fernando-martins",
    "name": "Fernando Martins",
    "firm": "Martins Law Firm",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Martins Law Firm",
    "suppression": null,
    "evidence": "B3",
    "website": "https://www.martinslawfirm.ca/",
    "email": "fernandomartins@martinslawfirm.ca",
    "phone": "416-536-5488",
    "sources": [
      "https://www.martinslawfirm.ca/about",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
    ],
    "unknowns": [
      "LSO email is fdmartins@hotmail.com; firm page email is fernandomartins@martinslawfirm.ca. Both are preserved."
    ],
    "domains": [
      "https://www.martinslawfirm.ca/about",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
    ],
    "sourceRecordId": "BAO-P-000035",
    "publicContact": {
      "email": "fernandomartins@martinslawfirm.ca",
      "phone": "416-536-5488",
      "website": "https://www.martinslawfirm.ca/",
      "bioUrl": "https://www.martinslawfirm.ca/about",
      "contactSourceUrl": "https://www.martinslawfirm.ca/about",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C",
      "provenance": [
        "baseline_68 plus saturation challenge plus live LSO verification"
      ],
      "lsoNumber": "34116C",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000035",
    "canonicalFirmId": "firm:martins-law-firm",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party page identifies Fernando as Founder, Lawyer and Notary Public and states service to clients from Brazil; LSO lists current Toronto private practice.",
      "https://www.martinslawfirm.ca/about",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.martinslawfirm.ca/",
        "host": "martinslawfirm.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.martinslawfirm.ca/about",
        "host": "martinslawfirm.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.martinslawfirm.ca/",
        "sourceUrl": "https://www.martinslawfirm.ca/",
        "evidenceIds": [
          "https://www.martinslawfirm.ca/about",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "fernandomartins@martinslawfirm.ca",
        "sourceUrl": "https://www.martinslawfirm.ca/about",
        "evidenceIds": [
          "https://www.martinslawfirm.ca/about",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-536-5488",
        "sourceUrl": "https://www.martinslawfirm.ca/about",
        "evidenceIds": [
          "https://www.martinslawfirm.ca/about",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=34116C"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "LSO email is fdmartins@hotmail.com; firm page email is fernandomartins@martinslawfirm.ca. Both are preserved."
    ]
  },
  {
    "operation": "add",
    "id": "krystle-ferreira",
    "name": "Krystle Ferreira",
    "firm": "Nova Law Firm Professional Corporation",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Nova Law Firm Professional Corporation",
    "suppression": null,
    "evidence": "B4",
    "website": "https://novalaw.ca/",
    "email": "krystle@novalaw.ca",
    "phone": "647-417-6682",
    "sources": [
      "https://novalaw.ca/principal-lawyer",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
    ],
    "unknowns": [
      "LSO lists Oakville business address while a secondary Toronto listing showed a different Nova Law address; Oakville remains the authoritative current LSO location."
    ],
    "domains": [
      "https://novalaw.ca/principal-lawyer",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
    ],
    "sourceRecordId": "BAO-P-000036",
    "publicContact": {
      "email": "krystle@novalaw.ca",
      "phone": "647-417-6682",
      "website": "https://novalaw.ca/",
      "bioUrl": "https://novalaw.ca/principal-lawyer",
      "contactSourceUrl": "https://novalaw.ca/principal-lawyer",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L",
      "provenance": [
        "baseline_68 plus saturation challenge plus live LSO verification"
      ],
      "lsoNumber": "73189L",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000036",
    "canonicalFirmId": "firm:nova-law-firm-professional-corporation",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party page identifies Krystle as principal lawyer and Portuguese-speaking; LSO lists current private practice and Nova Law business name.",
      "https://novalaw.ca/principal-lawyer",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://novalaw.ca/",
        "host": "novalaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://novalaw.ca/principal-lawyer",
        "host": "novalaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://novalaw.ca/",
        "sourceUrl": "https://novalaw.ca/",
        "evidenceIds": [
          "https://novalaw.ca/principal-lawyer",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "krystle@novalaw.ca",
        "sourceUrl": "https://novalaw.ca/principal-lawyer",
        "evidenceIds": [
          "https://novalaw.ca/principal-lawyer",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "647-417-6682",
        "sourceUrl": "https://novalaw.ca/principal-lawyer",
        "evidenceIds": [
          "https://novalaw.ca/principal-lawyer",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=73189L"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "LSO lists Oakville business address while a secondary Toronto listing showed a different Nova Law address; Oakville remains the authoritative current LSO location."
    ]
  },
  {
    "operation": "update",
    "id": "darlene-rites",
    "name": "Darlene Rites",
    "firm": "Rites Law",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Rites Law",
    "suppression": null,
    "evidence": "B4",
    "website": "https://riteslaw.ca/",
    "email": "info@riteslaw.com",
    "phone": "416-854-8546",
    "sources": [
      "https://riteslaw.ca/darlene-rites/",
      "https://riteslaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
    ],
    "unknowns": [],
    "domains": [
      "https://riteslaw.ca/darlene-rites/",
      "https://riteslaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
    ],
    "sourceRecordId": "BAO-P-000039",
    "publicContact": {
      "email": "info@riteslaw.com",
      "phone": "416-854-8546",
      "website": "https://riteslaw.ca/",
      "bioUrl": "https://riteslaw.ca/darlene-rites/",
      "contactSourceUrl": "https://riteslaw.ca/darlene-rites/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S",
      "provenance": [
        "baseline_68 plus targeted first-party ownership verification"
      ],
      "lsoNumber": "59932S",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000039",
    "canonicalFirmId": "firm:rites-law",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party Rites Law page identifies Darlene as Founder and Family Law Lawyer & Mediator.",
      "https://riteslaw.ca/darlene-rites/",
      "https://riteslaw.ca/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
    ],
    "researchEligibility": "secondary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://riteslaw.ca/",
        "host": "riteslaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://riteslaw.ca/darlene-rites/",
        "host": "riteslaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://riteslaw.ca/",
        "sourceUrl": "https://riteslaw.ca/",
        "evidenceIds": [
          "https://riteslaw.ca/darlene-rites/",
          "https://riteslaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "info@riteslaw.com",
        "sourceUrl": "https://riteslaw.ca/darlene-rites/",
        "evidenceIds": [
          "https://riteslaw.ca/darlene-rites/",
          "https://riteslaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "416-854-8546",
        "sourceUrl": "https://riteslaw.ca/darlene-rites/",
        "evidenceIds": [
          "https://riteslaw.ca/darlene-rites/",
          "https://riteslaw.ca/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=59932S"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "update",
    "id": "celso-sakuraba",
    "name": "Celso Sakuraba",
    "firm": "Sakuraba Law",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Sakuraba Law",
    "suppression": null,
    "evidence": "B2",
    "website": "https://sakurabalaw.ca/",
    "email": "contato@sakurabalaw.ca",
    "phone": "905-393-2999",
    "sources": [
      "https://sakurabalaw.ca/",
      "https://sakurabalaw.ca/sobre/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
    ],
    "unknowns": [
      "Current first-party site exposes a firm WhatsApp/intake route; the current LSO contact is a generic firm address, not a personal Celso email."
    ],
    "domains": [
      "https://sakurabalaw.ca/",
      "https://sakurabalaw.ca/sobre/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
    ],
    "sourceRecordId": "BAO-P-000051",
    "publicContact": {
      "email": "contato@sakurabalaw.ca",
      "phone": "905-393-2999",
      "website": "https://sakurabalaw.ca/",
      "bioUrl": "https://sakurabalaw.ca/sobre/",
      "contactSourceUrl": "https://sakurabalaw.ca/sobre/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L",
      "provenance": [
        "baseline_68 overlay and current-firm correction; current contact route reconciled to firm-level address"
      ],
      "lsoNumber": "84985L",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000051",
    "canonicalFirmId": "firm:sakuraba-law",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "Existing first-party Sakuraba Law owner evidence retained; LSO current private-practice record aligns.",
      "https://sakurabalaw.ca/",
      "https://sakurabalaw.ca/sobre/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://sakurabalaw.ca/",
        "host": "sakurabalaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://sakurabalaw.ca/sobre/",
        "host": "sakurabalaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://sakurabalaw.ca/",
        "sourceUrl": "https://sakurabalaw.ca/",
        "evidenceIds": [
          "https://sakurabalaw.ca/",
          "https://sakurabalaw.ca/sobre/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "contato@sakurabalaw.ca",
        "sourceUrl": "https://sakurabalaw.ca/sobre/",
        "evidenceIds": [
          "https://sakurabalaw.ca/",
          "https://sakurabalaw.ca/sobre/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "905-393-2999",
        "sourceUrl": "https://sakurabalaw.ca/sobre/",
        "evidenceIds": [
          "https://sakurabalaw.ca/",
          "https://sakurabalaw.ca/sobre/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=84985L"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "Current first-party site exposes a firm WhatsApp/intake route; the current LSO contact is a generic firm address, not a personal Celso email."
    ]
  },
  {
    "operation": "update",
    "id": "camila-motta",
    "name": "Camila Motta",
    "firm": "Revive Law Professional Corporation",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Revive Law Professional Corporation",
    "suppression": null,
    "evidence": "B3",
    "website": "https://www.revivelaw.ca/",
    "email": "camila@revivelaw.ca",
    "phone": "365-214-0100",
    "sources": [
      "https://www.revivelaw.ca/meet-camila",
      "https://www.revivelaw.ca/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
    ],
    "unknowns": [],
    "domains": [
      "https://www.revivelaw.ca/meet-camila",
      "https://www.revivelaw.ca/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
    ],
    "sourceRecordId": "BAO-P-000055",
    "publicContact": {
      "email": "camila@revivelaw.ca",
      "phone": "365-214-0100",
      "website": "https://www.revivelaw.ca/",
      "bioUrl": "https://www.revivelaw.ca/meet-camila",
      "contactSourceUrl": "https://www.revivelaw.ca/meet-camila",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B",
      "provenance": [
        "baseline_68 overlay"
      ],
      "lsoNumber": "80114B",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000055",
    "canonicalFirmId": "firm:revive-law-professional-corporation",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "Existing first-party owner evidence retained; LSO current private-practice record aligns.",
      "https://www.revivelaw.ca/meet-camila",
      "https://www.revivelaw.ca/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.revivelaw.ca/",
        "host": "revivelaw.ca",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.revivelaw.ca/meet-camila",
        "host": "revivelaw.ca",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.revivelaw.ca/contact",
        "host": "revivelaw.ca",
        "state": "unresolved",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.revivelaw.ca/",
        "sourceUrl": "https://www.revivelaw.ca/",
        "evidenceIds": [
          "https://www.revivelaw.ca/meet-camila",
          "https://www.revivelaw.ca/contact",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "camila@revivelaw.ca",
        "sourceUrl": "https://www.revivelaw.ca/meet-camila",
        "evidenceIds": [
          "https://www.revivelaw.ca/meet-camila",
          "https://www.revivelaw.ca/contact",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "365-214-0100",
        "sourceUrl": "https://www.revivelaw.ca/meet-camila",
        "evidenceIds": [
          "https://www.revivelaw.ca/meet-camila",
          "https://www.revivelaw.ca/contact",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=80114B"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "update",
    "id": "susana-figueiredo-sobral-cruz",
    "name": "Susana Figueiredo Sobral Cruz",
    "firm": "Sobral Cruz Legal Services",
    "bucket": "explicit",
    "researchSet": "brazil_connected_ready",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Sobral Cruz Legal Services",
    "suppression": null,
    "evidence": "B2",
    "website": "https://sobralcruz.com/",
    "email": "susana@sobralcruz.com",
    "phone": "647-719-5579",
    "sources": [
      "https://sobralcruz.com/",
      "https://bcba.legal/directory/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
    ],
    "unknowns": [],
    "domains": [
      "https://sobralcruz.com/",
      "https://bcba.legal/directory/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
    ],
    "sourceRecordId": "BAO-P-000066",
    "publicContact": {
      "email": "susana@sobralcruz.com",
      "phone": "647-719-5579",
      "website": "https://sobralcruz.com/",
      "bioUrl": "https://sobralcruz.com/",
      "contactSourceUrl": "https://sobralcruz.com/",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E",
      "provenance": [
        "baseline_68 plus targeted first-party ownership verification"
      ],
      "lsoNumber": "90720E",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-P-000066",
    "canonicalFirmId": "firm:sobral-cruz-legal-services",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party Sobral Cruz page identifies Susana as Founder & Lawyer and dual-licensed Brazil/Ontario; LSO/BCBA corroborate current Toronto practice.",
      "https://sobralcruz.com/",
      "https://bcba.legal/directory/",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
    ],
    "researchEligibility": "primary_owner_cohort",
    "researchState": "eligible",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://sobralcruz.com/",
        "host": "sobralcruz.com",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      },
      {
        "url": "https://bcba.legal/directory/",
        "host": "bcba.legal",
        "state": "unresolved",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://sobralcruz.com/",
        "sourceUrl": "https://sobralcruz.com/",
        "evidenceIds": [
          "https://sobralcruz.com/",
          "https://bcba.legal/directory/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "email",
        "value": "susana@sobralcruz.com",
        "sourceUrl": "https://sobralcruz.com/",
        "evidenceIds": [
          "https://sobralcruz.com/",
          "https://bcba.legal/directory/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "647-719-5579",
        "sourceUrl": "https://sobralcruz.com/",
        "evidenceIds": [
          "https://sobralcruz.com/",
          "https://bcba.legal/directory/",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=90720E"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": []
  },
  {
    "operation": "add",
    "id": "bruno-filipe-teixeira",
    "name": "Bruno Filipe Teixeira",
    "firm": "Teixeira Law Office",
    "bucket": "portuguese",
    "researchSet": "portuguese_only_brazil_unconfirmed",
    "outreachEligibility": "INTERNAL_CANDIDATE_UNSENT",
    "currentPrimaryFirm": "Teixeira Law Office",
    "suppression": null,
    "evidence": "B4",
    "website": "https://www.teixeiralawoffice.com/",
    "phone": "519-267-6070",
    "sources": [
      "https://www.teixeiralawoffice.com/our-team",
      "https://www.teixeiralawoffice.com/about-3",
      "https://www.teixeiralawoffice.com/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E"
    ],
    "unknowns": [
      "No public email observed on the current first-party contact page.",
      "No Brazil-specific connection found; B4 is Portuguese-language/service evidence only.",
      "Physical office is Cambridge, outside the GTA, while first-party service page names GTA communities."
    ],
    "domains": [
      "https://www.teixeiralawoffice.com/our-team",
      "https://www.teixeiralawoffice.com/about-3",
      "https://www.teixeiralawoffice.com/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E"
    ],
    "sourceRecordId": "BAO-RCA-20260907-P002",
    "publicContact": {
      "email": null,
      "phone": "519-267-6070",
      "website": "https://www.teixeiralawoffice.com/",
      "bioUrl": "https://www.teixeiralawoffice.com/our-team",
      "contactSourceUrl": "https://www.teixeiralawoffice.com/our-team",
      "lsoSourceUrl": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E",
      "provenance": [
        "owner-operator recall plus live LSO verification; current contact page publishes phone and intake form, not a public email"
      ],
      "lsoNumber": "51429E",
      "practiceAreas": [],
      "status": "current_lso_and_first_party",
      "role": null,
      "suppressionReason": null
    },
    "canonicalPersonId": "BAO-RCA-20260907-P002",
    "canonicalFirmId": "firm:teixeira-law-office",
    "ownerAuthority": "O1",
    "ownerAuthorityEvidence": [
      "First-party team page says Bruno started his own practice; LSO lists current Teixeira Law Office private practice. First-party service page names Toronto, Mississauga, Vaughan and Oakville service areas.",
      "https://www.teixeiralawoffice.com/our-team",
      "https://www.teixeiralawoffice.com/about-3",
      "https://www.teixeiralawoffice.com/contact",
      "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E"
    ],
    "researchEligibility": "hold_owner_authority_review",
    "researchState": "screened",
    "interviewState": "not_started",
    "evidenceConfidence": "corroborated",
    "domainRelationships": [
      {
        "url": "https://www.teixeiralawoffice.com/",
        "host": "teixeiralawoffice.com",
        "state": "current_primary",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.teixeiralawoffice.com/our-team",
        "host": "teixeiralawoffice.com",
        "state": "professional_profile",
        "confidence": "corroborated"
      },
      {
        "url": "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E",
        "host": "lsodirectory.lso.ca",
        "state": "regulator",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.teixeiralawoffice.com/about-3",
        "host": "teixeiralawoffice.com",
        "state": "unresolved",
        "confidence": "corroborated"
      },
      {
        "url": "https://www.teixeiralawoffice.com/contact",
        "host": "teixeiralawoffice.com",
        "state": "unresolved",
        "confidence": "corroborated"
      }
    ],
    "contactSourceProvenance": [
      {
        "field": "website",
        "value": "https://www.teixeiralawoffice.com/",
        "sourceUrl": "https://www.teixeiralawoffice.com/",
        "evidenceIds": [
          "https://www.teixeiralawoffice.com/our-team",
          "https://www.teixeiralawoffice.com/about-3",
          "https://www.teixeiralawoffice.com/contact",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E"
        ],
        "confidence": "corroborated"
      },
      {
        "field": "phone",
        "value": "519-267-6070",
        "sourceUrl": "https://www.teixeiralawoffice.com/our-team",
        "evidenceIds": [
          "https://www.teixeiralawoffice.com/our-team",
          "https://www.teixeiralawoffice.com/about-3",
          "https://www.teixeiralawoffice.com/contact",
          "https://lsodirectory.lso.ca/en-US/licensee-detail/?lawsocietynumber=51429E"
        ],
        "confidence": "corroborated"
      }
    ],
    "explicitUnknowns": [
      "No public email observed on the current first-party contact page.",
      "No Brazil-specific connection found; B4 is Portuguese-language/service evidence only.",
      "Physical office is Cambridge, outside the GTA, while first-party service page names GTA communities."
    ]
  }
] as const satisfies readonly ProspectOwnerCohortUpdate[];
