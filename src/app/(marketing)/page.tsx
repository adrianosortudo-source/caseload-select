import { permanentRedirect } from "next/navigation";

/** Retire the legacy marketing homepage in favor of the current website. */
export default function MarketingHomePage(): never {
  permanentRedirect("https://caseloadselect.ca/");
}
