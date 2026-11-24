import 'server-only';
import { screenParityPreviewEnabled } from './screen-parity-preview-enabled';

export function admitScreenQuestionPolicy(requested: unknown, followUp: boolean) {
  if (requested !== 'grounded_v1' || !screenParityPreviewEnabled()) return undefined;
  // Stop admitting new enquiries without interrupting tabs that already
  // started on the newer protocol.
  if (followUp || process.env.SCREEN_PARITY_QUESTION_POLICY === 'grounded_v1') {
    return 'grounded_v1' as const;
  }
  return undefined;
}
