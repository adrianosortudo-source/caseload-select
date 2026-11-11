/** A conservative demo-only proposal; the visitor must confirm it. */
export function demoDeadlineProposal(input: string, now: Date = new Date()): { value: string; dateText: string } | null {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const datePattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  const dates = [...input.matchAll(datePattern)];
  if (dates.length !== 1 || !Number.isFinite(now.getTime())) return null;
  const date = dates[0];
  const sentence = input.split(/[.!?;\n]+/).find((part) => part.includes(date[0]));
  const clause = sentence?.split(/\b(?:but|however)\b/i).find((part) => part.includes(date[0]));
  if (!clause || /\b(?:no|not|never|without|cannot|can't|don't|doesn't|didn't|won't|wouldn't|isn't|aren't|hasn't|haven't|may|might|maybe|if|unless|unsure|uncertain)\b/i.test(clause.replace(date[0], ""))) return null;
  const escapedDate = date[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`\\b(?:(?:respond|reply|sign|accept)\\s+by|deadline(?:\\s+to\\s+(?:respond|reply|sign|accept))?\\s+(?:is|of))\\s+${escapedDate}`, "i").test(clause)) return null;
  const month = months.indexOf(date[1].toLowerCase());
  const day = Number(date[2]);
  const year = Number(date[3]);
  const target = new Date(Date.UTC(year, month, day));
  if (target.getUTCFullYear() !== year || target.getUTCMonth() !== month || target.getUTCDate() !== day) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today) / 86_400_000);
  if (days > 31) return null;
  const value = days < 0 ? "The deadline has already passed" : days <= 3 ? "Yes, in the next few days" : days <= 7 ? "Yes, within the next week" : "Yes, within the next month";
  return { value, dateText: date[0] };
}
