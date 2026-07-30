# DRG Law Native Intake Integration

DRG Law should render the intake as a first-party component, not as a
cross-origin iframe. The first screen then ships with the DRG page shell and
appears as smoothly as any other section of the site.

## CaseLoad Export

Use the public intake boundary:

```tsx
import { ScreenEnginePublicWidget } from "@/components/intake-v2/public";
```

For a monorepo/shared-package setup, expose that module as the package entry
for the host site. Do not import the iframe route.

## DRG Component

```tsx
"use client";

import { ScreenEnginePublicWidget } from "@caseloadselect/public-intake";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

export function DrgNativeIntake({ lang = "en" }: { lang?: "en" | "pt" }) {
  return (
    <ScreenEnginePublicWidget
      firmId={DRG_FIRM_ID}
      firmName="DRG Law"
      initialLang={lang}
      consentCaptureEnabled
      submitEndpoint="/api/intake"
    />
  );
}
```

## DRG Proxy Route

Create `app/api/intake/route.ts` in the DRG site. The browser posts to the DRG
origin; the server forwards to CaseLoad.

```ts
import { NextRequest, NextResponse } from "next/server";

const CASELOAD_INTAKE_URL =
  "https://app.caseloadselect.ca/api/intake-v2?firmId=eec1d25e-a047-4827-8e4a-6eb96becca2b";

export async function POST(req: NextRequest) {
  const body = await req.text();

  const upstream = await fetch(CASELOAD_INTAKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      Origin: "https://drglaw.ca",
    },
    body,
    cache: "no-store",
  });

  const text = await upstream.text();

  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
```

## Placement

Render `DrgNativeIntake` directly inside `/intake`, `/contact`, and the homepage
intake section. Remove the iframe and the `Preparing the matter form` skeleton
from DRG once the native component is in place.

## Rollback

Keep the existing iframe URL as a plain fallback link:

```tsx
<a href="https://app.caseloadselect.ca/widget-public/eec1d25e-a047-4827-8e4a-6eb96becca2b">
  Open intake in a new tab
</a>
```
