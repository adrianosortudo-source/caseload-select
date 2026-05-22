/**
 * Client invite accept page.
 *
 * URL: /portal/[firmId]/m/[matterId]/accept?token=...
 *
 * Verifies the token, plants a 30-day session cookie scoped to the
 * matter, redirects to the matter home. If the token is invalid or
 * expired, surfaces a polite error with instructions to request a
 * new link from the firm.
 *
 * This is a server component that does the work in a server action
 * dispatched via a hidden form on first load. Keeps the token off
 * the client JS bundle.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  verifyPortalToken,
  createSessionCookie,
} from '@/lib/portal-auth';

interface AcceptPageProps {
  params: Promise<{ firmId: string; matterId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function ClientAcceptPage({
  params,
  searchParams,
}: AcceptPageProps) {
  const { firmId, matterId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return <AcceptErrorView reason="missing_token" />;
  }

  const session = verifyPortalToken(token);
  if (!session) {
    return <AcceptErrorView reason="invalid_or_expired" />;
  }
  if (session.role !== 'client') {
    return <AcceptErrorView reason="wrong_role" />;
  }
  if (session.firm_id !== firmId || session.matter_id !== matterId) {
    return <AcceptErrorView reason="wrong_scope" />;
  }

  // Plant the cookie + redirect.
  const cookie = createSessionCookie(firmId, {
    role: 'client',
    matter_id: matterId,
    client_email: session.client_email,
  });
  const store = await cookies();
  store.set(cookie.name, cookie.value, cookie.options);

  redirect(`/portal/${firmId}/m/${matterId}`);
}

function AcceptErrorView({
  reason,
}: {
  reason: 'missing_token' | 'invalid_or_expired' | 'wrong_role' | 'wrong_scope';
}) {
  const messages: Record<string, string> = {
    missing_token: 'This link is missing the access token. Please use the full link from your email.',
    invalid_or_expired: 'This link has expired or is no longer valid. Reply to the email you received and the firm will send you a fresh one.',
    wrong_role: 'This link is configured for a different type of session.',
    wrong_scope: 'This link does not match the page you are trying to access.',
  };
  return (
    <main style={{ maxWidth: 520, margin: '64px auto', padding: 24, fontFamily: 'Manrope, system-ui, sans-serif' }}>
      <h1 style={{ color: '#1E2F58', fontSize: '1.4rem', marginBottom: 16 }}>
        We could not open your secure page
      </h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>{messages[reason]}</p>
    </main>
  );
}
