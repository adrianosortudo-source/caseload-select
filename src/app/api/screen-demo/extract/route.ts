const NO_STORE = { "Cache-Control": "no-store" };

// Older tabs still query this endpoint before displaying their live option.
export function GET() {
  return Response.json({ available: false }, { headers: NO_STORE });
}

export function POST(_request: Request) {
  return Response.json({ mode: "disabled", extracted: {} }, { status: 409, headers: NO_STORE });
}
