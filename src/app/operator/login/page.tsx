/**
 * /operator/login
 *
 * Dedicated operator sign-in surface. Operator requests are resolved only
 * against active firm_lawyers rows with role='operator', so an email that is
 * also registered as a lawyer cannot be routed by last-sign-in recency.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import RequestLinkForm from "@/components/portal/RequestLinkForm";
import { getOperatorSession } from "@/lib/portal-auth";
import { appOrigin } from "@/lib/app-origins";

export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getOperatorSession()) {
    redirect("/admin");
  }

  const { error } = await searchParams;
  const errorMessage =
    error === "expired" ? "This link has expired. Request a new one below."
    : error === "invalid" ? "This operator link is invalid. Request a new one below."
    : error === "missing" ? "Sign-in link missing. Enter your operator email below."
    : null;

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-sm w-full space-y-4">
        <div className="text-center font-display font-semibold text-lg text-navy tracking-wide">
          CaseLoad Select
        </div>

        <div
          className="bg-white border border-black/8 p-6 sm:p-8 space-y-5"
          data-ui-component-content="operator-login-card"
        >
          <div>
            <p className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-gold" data-ui-copy="supporting">
              Operator console
            </p>
            <h1
              className="mt-2 text-2xl font-bold text-navy"
              style={{ lineHeight: "1.2" }}
              data-ui-copy="heading"
            >
              Operator access
            </h1>
            <p className="mt-2 text-sm text-black/60 text-pretty" data-ui-copy="supporting">
              Enter your operator email to receive a secure sign-in link. Once you use it, this trusted browser stays signed in for 30 days unless you sign out or clear browser data.
            </p>
          </div>

          {errorMessage && (
            <div
              className="bg-parchment border border-black/8 px-3 py-2 text-xs text-black/70 text-pretty"
              data-ui-copy="supporting"
            >
              {errorMessage}
            </div>
          )}

          <RequestLinkForm
            endpoint="/api/operator/request-link"
            errorMessage="Something went wrong. Try again or contact CaseLoad Select support."
            surfaceName="operator-login"
          />

          <p className="border-t border-black/8 pt-4 text-sm text-black/60 text-pretty" data-ui-copy="supporting">
            Looking for your firm workspace?{" "}
            <Link href={`${appOrigin()}/portal/login`} className="font-semibold text-navy underline underline-offset-2 hover:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-2">
              Use lawyer sign in.
            </Link>
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 text-xs text-black/40">
          <span>caseloadselect.ca</span>
          <span aria-hidden>·</span>
          <a href="/privacy" className="hover:text-navy transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-2">Privacy</a>
          <span aria-hidden>·</span>
          <a href="/terms" className="hover:text-navy transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-2">Terms</a>
        </div>
      </div>
    </div>
  );
}
