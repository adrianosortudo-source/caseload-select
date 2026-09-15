import type {
  ChannelIntakeExchange,
  ChannelIntakeHistoryView,
} from "@/lib/channel-intake-history";

interface Props {
  history: ChannelIntakeHistoryView;
}

const RECORDED_SPEAKER_LABEL: Record<ChannelIntakeExchange["direction"], string> = {
  outbound: "Intake assistant",
  inbound: "Lead",
};

const RECONSTRUCTED_SPEAKER_LABEL: Record<ChannelIntakeExchange["direction"], string> = {
  outbound: "Reconstructed question",
  inbound: "Saved answer",
};

function formatOccurredAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(date);
}

function answerMeaning(event: ChannelIntakeExchange): string[] {
  if (event.direction !== "inbound") return [];
  return [
    ...new Set(event.normalizedAnswers.map((answer) => answer.value.trim()).filter(Boolean)),
  ].filter((value) => value !== event.body.trim());
}

export default function IntakeTranscriptPanel({ history }: Props) {
  const events = [...history.events].sort((a, b) => a.sequence - b.sequence);
  const exact = history.provenance === "recorded";
  const questionsById = new Map(
    events
      .filter((event) => event.direction === "outbound")
      .map((event) => [event.id, event] as const),
  );
  const headerSummary = exact
    ? "Questions and responses are shown in the order recorded during intake."
    : events.length > 0
      ? history.notice ?? "Available intake evidence is shown below."
      : "Available intake evidence is shown below.";

  return (
    <section
      className="border border-black/10 bg-white"
      aria-labelledby="intake-record-heading"
      data-intake-transcript-panel
    >
      <header
        className="border-b border-black/10 px-4 py-4 sm:px-6 sm:py-5"
        data-ui-component-content="intake-record-heading"
      >
        <p
          className="w-full text-xs font-semibold uppercase tracking-wider text-gold"
          data-ui-copy="supporting"
        >
          Intake evidence
        </p>
        <h2
          id="intake-record-heading"
          className="mt-1 w-full text-lg font-bold text-navy text-pretty sm:text-xl"
          data-ui-copy="heading"
        >
          Intake transcript
        </h2>
        <p
          className="mt-2 w-full text-sm leading-relaxed text-black/60 text-pretty"
          data-ui-copy="supporting"
        >
          {headerSummary}
        </p>
        {exact && history.notice && (
          <p
            className="mt-1 w-full text-sm leading-relaxed text-amber-800 text-pretty"
            data-ui-copy="supporting"
          >
            {history.notice}
          </p>
        )}
      </header>

      {events.length > 0 ? (
        <ol className="divide-y divide-black/10" aria-label="Intake exchanges">
          {events.map((event) => {
            const occurredAt = formatOccurredAt(event.occurredAt);
            const meanings = answerMeaning(event);
            const attentionStatus =
              event.status === "failed" ||
              event.status === "pending" ||
              event.status === "delivery_unknown";
            const linkedQuestion = event.replyToEventId
              ? questionsById.get(event.replyToEventId)
              : null;
            const savedOption = !exact
              ? linkedQuestion?.options?.find(
                  (option) =>
                    option.value === event.body ||
                    event.normalizedAnswers.some((answer) => answer.value === option.value),
                )
              : null;
            const displayedBody = savedOption?.label ?? event.body;

            return (
              <li key={event.id} className="px-4 py-4 sm:px-6">
                <article className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-5">
                  <div className="min-w-0 text-xs text-black/50">
                    <p className="w-full font-semibold uppercase tracking-wider text-navy">
                      {(exact ? RECORDED_SPEAKER_LABEL : RECONSTRUCTED_SPEAKER_LABEL)[
                        event.direction
                      ]}
                    </p>
                    {occurredAt && (
                      <time dateTime={event.occurredAt ?? undefined}>{occurredAt}</time>
                    )}
                    {attentionStatus && (
                      <p className="mt-1 w-full font-semibold text-amber-800">
                        {event.status.replaceAll("_", " ")}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-deep-black">
                      {displayedBody}
                    </p>
                    {!exact && event.options && event.options.length > 0 && (
                      <ol className="mt-3 grid w-full grid-cols-1 gap-1.5 text-sm text-black/70 sm:grid-cols-2">
                        {event.options.map((option) => (
                          <li
                            key={`${event.id}:${option.number}`}
                            className="border border-black/10 bg-parchment px-3 py-2"
                          >
                            <span className="font-semibold text-navy">{option.number}.</span>{" "}
                            {option.label}
                            {option.description && (
                              <span className="mt-0.5 block w-full text-xs leading-relaxed text-black/55">
                                {option.description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    {meanings.length > 0 && (
                      <div className="mt-2 w-full border-l-2 border-gold pl-3 text-xs leading-relaxed text-black/60">
                        <span className="font-semibold text-black/70">Recorded meaning:</span>{" "}
                        {meanings.join(", ")}
                      </div>
                    )}
                    {event.bodyTruncated && (
                      <p className="mt-2 w-full text-xs text-amber-800">
                        This message was shortened when saved. Original size:{" "}
                        {event.originalByteLength ?? "unknown"} bytes.
                      </p>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="w-full px-4 py-5 text-sm text-black/60 sm:px-6">
          {history.notice ?? "No intake exchange record is available for this lead."}
        </p>
      )}

      {history.rawTranscript && (
        <details
          className="border-t border-black/10 px-4 py-4 sm:px-6"
          open={history.provenance === "raw_only"}
        >
          <summary className="w-full cursor-pointer text-sm font-semibold text-navy">
            Original saved inbound text
          </summary>
          <p className="mt-2 w-full text-xs leading-relaxed text-black/55">
            This text is preserved as one unstructured record. Its lines are not paired to
            questions by position.
          </p>
          <div className="mt-3 w-full whitespace-pre-wrap break-words border border-black/10 bg-parchment px-3 py-3 text-sm leading-relaxed text-black/70">
            {history.rawTranscript}
          </div>
        </details>
      )}
    </section>
  );
}
