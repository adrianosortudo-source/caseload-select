export function PublicScreenSandboxFrame({ query = "" }: { query?: string }) {
  return (
    <main aria-label="SCREEN demonstration" style={{ width: "100%", minHeight: "100dvh" }}>
      <iframe
        title="SCREEN practice-area and channel demonstration"
        src={"/screen-demo-app/index.html" + (query ? "?" + query : "")}
        allow="clipboard-write"
        referrerPolicy="same-origin"
        style={{ display: "block", width: "100%", height: "100dvh", border: 0 }}
      />
    </main>
  );
}
