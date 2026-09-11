/** Shared message composition. This function never sends or schedules a message. */
export function buildVoiceScreenSms(senderName: string, link: string): string {
  return `Thanks for calling ${senderName}. Here is the link we discussed to help our team prepare: ${link} You can skip questions. Please avoid confidential details or documents. Reply STOP to opt out.`;
}
