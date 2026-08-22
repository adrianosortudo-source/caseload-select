"use client";

import { useCallback, useRef } from "react";
import type {
  ScreenFunnelAnswerMode,
  ScreenFunnelEventName,
  ScreenFunnelEventV1,
  ScreenFunnelLocale,
  ScreenFunnelStage,
  ScreenFunnelViewport,
} from "./screen-funnel-schema";

export interface ScreenFunnelTelemetryOptions {
  telemetryEnabled: boolean;
  contextToken: string | null;
  locale: ScreenFunnelLocale;
  viewport: ScreenFunnelViewport;
}

export interface ScreenFunnelPrimitiveEvent {
  event: ScreenFunnelEventName;
  stage: ScreenFunnelStage;
  stepIndex: number;
  questionCount: number;
  answerMode?: ScreenFunnelAnswerMode;
  isRevisit?: boolean;
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Primitive-only client telemetry transport for a later widget integration.
 * Its public methods do not accept question objects, answers, descriptions,
 * reports, contacts, lead IDs, or engine state, so those values cannot be
 * accidentally serialized by the instrumentation call site.
 */
export function useScreenFunnelTelemetry(options: ScreenFunnelTelemetryOptions) {
  const flowId = useRef<string | null>(options.telemetryEnabled ? newUuid() : null);
  const sequence = useRef(0);
  const startedAt = useRef<number | null>(options.telemetryEnabled ? performance.now() : null);
  const presented = useRef(new Set<string>());

  const emit = useCallback((primitive: ScreenFunnelPrimitiveEvent) => {
    if (!options.telemetryEnabled || !options.contextToken) return;
    if (!flowId.current) flowId.current = newUuid();
    if (startedAt.current === null) startedAt.current = performance.now();
    const payload: ScreenFunnelEventV1 = {
      schemaVersion: 1,
      eventId: newUuid(),
      flowId: flowId.current,
      sequence: sequence.current++,
      contextToken: options.contextToken,
      event: primitive.event,
      stage: primitive.stage,
      stepIndex: primitive.stepIndex,
      questionCount: primitive.questionCount,
      ...(primitive.answerMode ? { answerMode: primitive.answerMode } : {}),
      ...(primitive.isRevisit ? { isRevisit: true } : {}),
      locale: options.locale,
      viewport: options.viewport,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt.current)),
    };
    void fetch("/api/screen-funnel/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  }, [options.contextToken, options.locale, options.telemetryEnabled, options.viewport]);

  const presentQuestion = useCallback((stepIndex: number, questionCount: number, isRevisit = false) => {
    const key = `${stepIndex}:${questionCount}:${isRevisit}`;
    if (presented.current.has(key)) return;
    presented.current.add(key);
    emit({ event: "question_presented", stage: "discovery", stepIndex, questionCount, ...(isRevisit ? { isRevisit: true } : {}) });
  }, [emit]);

  const restart = useCallback((priorStepIndex: number, questionCount: number) => {
    emit({ event: "flow_restarted", stage: "discovery", stepIndex: priorStepIndex, questionCount });
    flowId.current = options.telemetryEnabled ? newUuid() : null;
    sequence.current = 0;
    startedAt.current = options.telemetryEnabled ? performance.now() : null;
    presented.current.clear();
  }, [emit, options.telemetryEnabled]);

  return { emit, presentQuestion, restart };
}
