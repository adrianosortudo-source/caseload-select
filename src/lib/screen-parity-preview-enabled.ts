import 'server-only';

/** Keep comparison fixtures and their simulated delivery endpoints off production. */
export function screenParityPreviewEnabled(): boolean {
  return process.env.VERCEL_ENV === 'preview' ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'development');
}
