import type { EngineState, Channel } from './types';

/** A channel-aware acknowledgment; it makes no claim about firm action. */
export function buildClosingMessage(state: EngineState): string {
  const channel: Channel = state.channel ?? 'web';
  if (channel === 'web' || channel === 'voice') return '';

  const pt = state.language === 'pt';
  if (channel === 'sms' || channel === 'gbp') {
    return pt ? 'Obrigado por compartilhar essas informações.' : 'Thank you for sharing this information.';
  }

  const rawName = state.slots['client_name'];
  const first = typeof rawName === 'string' ? rawName.trim().split(/\s+/)[0] : '';
  const name = first && first.length >= 2 ? ` ${first}` : '';
  return pt
    ? `Obrigado${name} por compartilhar essas informações. Se a situação for urgente, entre em contato diretamente com o escritório.`
    : `Thank you${name} for sharing this information. If your situation is time-sensitive, please call the firm directly.`;
}
