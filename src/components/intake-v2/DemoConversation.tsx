"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./DemoConversation.module.css";

export interface DemoConversationMessage {
  id: string;
  role: "assistant" | "visitor";
  text: string;
  options?: readonly string[];
  speaker?: string;
  verbatim?: boolean;
}

export interface DemoConversationAction {
  label: string;
  onClick: () => void;
}

interface DemoConversationProps {
  messages: readonly DemoConversationMessage[];
  onSend: (text: string) => void;
  placeholder: string;
  initialDraft?: string;
  minChars?: number;
  disabled?: boolean;
  actionsDisabled?: boolean;
  status?: string | null;
  actions?: readonly DemoConversationAction[];
}

/** Local presentation only. The widget owns the engine and all session state. */
export function DemoConversation({ messages, onSend, placeholder, initialDraft = "", minChars = 1, disabled = false, actionsDisabled = false, status, actions = [] }: DemoConversationProps) {
  const [draft, setDraft] = useState(initialDraft);
  const history = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const resize = () => {
      if (!node.clientWidth) return;
      node.style.height = "auto";
      const fullHeight = node.scrollHeight + 2;
      node.style.height = `${Math.min(fullHeight, 140)}px`;
      node.style.overflowY = fullHeight > 140 ? "auto" : "hidden";
    };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; resize(); }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [draft]);
  useEffect(() => {
    const node = history.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, status]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = draft.trim();
    if (disabled || text.length < minChars) return;
    setDraft("");
    onSend(text);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return <section className={styles.conversation} aria-label="Fictional intake conversation" data-ui-component-content="demo-conversation">
    <div ref={history} className={styles.history} data-ui-control-scroll="conversation-history" role="log" aria-live="polite" aria-relevant="additions text">
      {messages.map((message) => <div key={message.id} className={`${styles.message} ${message.role === "visitor" ? styles.visitorMessage : styles.assistantMessage}`} data-ui-component-content="demo-conversation-message">
        <span className={styles.speaker}>{message.speaker ?? (message.role === "visitor" ? "You" : "CaseLoad Select")}</span>
        <p data-ui-copy="body" {...(message.role === "visitor" || message.verbatim ? { "data-ui-copy-exception": "User-authored fictional message preserved verbatim" } : {})}>{message.text}</p>
        {message.options && message.options.length > 0 && <ol className={styles.options}>{message.options.map((option, index) => <li className={styles.option} key={`${index}-${option}`}>{option}</li>)}</ol>}
      </div>)}
      {status && <p className={styles.status} role="status">{status}</p>}
    </div>
    {actions.length > 0 && <div className={styles.actions}>{actions.map((action) => <button type="button" key={action.label} className={styles.action} onClick={action.onClick} disabled={actionsDisabled}>{action.label}</button>)}</div>}
    {draft.trim().length > 0 && draft.trim().length < minChars && <p className={styles.status} role="status">Please enter at least {minChars} characters.</p>}
    <form className={styles.composer} onSubmit={submit}>
      <label className="sr-only" htmlFor="demo-conversation-reply">Your fictional message</label>
      <textarea ref={input} id="demo-conversation-reply" className={styles.input} data-ui-control-scroll="conversation-composer" rows={2} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} />
      <button className={styles.sendButton} type="submit" disabled={disabled || draft.trim().length < minChars}>Send in demo</button>
    </form>
  </section>;
}
