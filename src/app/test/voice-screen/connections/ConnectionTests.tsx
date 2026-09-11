"use client";

import Link from "next/link";
import { useState } from "react";
import { planVoiceScreenCall, type VoiceScreenCall } from "@/lib/voice-screen-bridge";
import { buildVoiceScreenSms } from "@/lib/voice-screen-message";
import styles from "./connections.module.css";

const scope = { locationId: "fictional-location", agentId: "fictional-agent" };
const inactiveLink = "https://example.invalid/widget/voice-continuation#inactive-test-link";

export function ConnectionTests() {
  const [permission, setPermission] = useState<VoiceScreenCall["permission"]["value"]>("granted");
  const [safeToText, setSafeToText] = useState<VoiceScreenCall["safeToText"]["value"]>("yes");
  const [urgency, setUrgency] = useState<VoiceScreenCall["urgency"]>("routine");
  const [callerType, setCallerType] = useState<VoiceScreenCall["callerType"]>("new");
  const [humanRequested, setHumanRequested] = useState(false);
  const [senderName, setSenderName] = useState("Example Law Firm");

  const plan = planVoiceScreenCall({
    ...scope,
    callId: "fictional-call",
    endedAt: "2026-09-11T16:00:00Z",
    callerType, urgency, humanRequested,
    callback: { number: "+14165550142", verifiedOnCallId: "fictional-call" },
    permission: { value: permission, callId: "fictional-call", capturedAt: "2026-09-11T15:59:00Z" },
    safeToText: { value: safeToText, callId: "fictional-call" },
  }, scope);
  const sms = buildVoiceScreenSms(senderName.trim() || "Example Law Firm", inactiveLink);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header} data-ui-component-content="connection-test-heading">
          <p className={styles.eyebrow} data-ui-copy="supporting">Voice intake tests</p>
          <h1 data-ui-copy="heading">Connection tests</h1>
          <p data-ui-copy="body">Tests message content and handoff policy. Real provider delivery and signed event verification are separate connection tests.</p>
          <Link className={styles.back} href="/test/voice-screen">Open the intake widget</Link>
        </header>
        <div className={styles.columns}>
          <section className={styles.panel} data-ui-component-content="handoff-test">
            <h2 data-ui-copy="heading">Call handoff</h2>
            <p data-ui-copy="body">Change the fictional call answers to check the invitation rules used by the live journey.</p>
            <div className={styles.controls}>
              <label>Permission to text
                <select value={permission} onChange={event => setPermission(event.target.value as typeof permission)}>
                  <option value="granted">Granted</option><option value="declined">Declined</option><option value="unknown">Not established</option>
                </select>
              </label>
              <label>Safe to text this number
                <select value={safeToText} onChange={event => setSafeToText(event.target.value as typeof safeToText)}>
                  <option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not established</option>
                </select>
              </label>
              <label>Caller relationship
                <select value={callerType} onChange={event => setCallerType(event.target.value as typeof callerType)}>
                  <option value="new">New inquiry</option><option value="existing">Existing client</option><option value="other">Other</option><option value="unknown">Not established</option>
                </select>
              </label>
              <label>Urgency
                <select value={urgency} onChange={event => setUrgency(event.target.value as typeof urgency)}>
                  <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="unknown">Not established</option>
                </select>
              </label>
              <label className={styles.checkbox}>
                <input type="checkbox" checked={humanRequested} onChange={event => setHumanRequested(event.target.checked)} />
                Caller asks for a person
              </label>
            </div>
            <div className={styles.result} aria-live="polite" data-ui-component-content="handoff-result">
              <h3 data-ui-copy="heading">{plan.invitationEligible ? "Text allowed" : "Human follow-up"}</h3>
              <p data-ui-copy="body">{plan.invitationEligible
                ? "These call answers allow a text invitation. Sending still requires a valid inquiry and the configured delivery connection."
                : "These call answers do not allow a text invitation. The team should handle the callback request."}</p>
              <p data-ui-copy="supporting">The callback request stays open in both cases. No message or follow-up task is created by this test.</p>
            </div>
          </section>
          <section className={styles.panel} data-ui-component-content="message-test">
            <h2 data-ui-copy="heading">Text message</h2>
            <p data-ui-copy="body">This is the same message template used by the SMS sender. The example link is inactive.</p>
            <label className={styles.sender}>Firm name
              <input value={senderName} onChange={event => setSenderName(event.target.value)} maxLength={100} />
            </label>
            <div className={styles.message} data-ui-component-content="message-content">
              <p data-ui-copy="body">{sms}</p>
            </div>
            <p className={styles.note} data-ui-copy="supporting">Review the wording here. A separate delivery test confirms that a real text reaches the selected phone and opens a valid session.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
