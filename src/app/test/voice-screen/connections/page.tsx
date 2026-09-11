import type { Metadata } from "next";
import { ConnectionTests } from "./ConnectionTests";

export const metadata: Metadata = {
  title: "Voice intake connection tests | CaseLoad Select",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ConnectionTests />;
}
