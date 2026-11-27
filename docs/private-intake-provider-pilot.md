# Private intake and recording providers

## Browser recordings

The first-party firm widgets at `/widget/[firmId]` and `/widget-v2/[firmId]` resolve the firm on the server. The kickoff recorder captures up to 60 seconds, converts it to mono 16 kHz WAV in the browser and calls `POST /api/transcribe`. Its response fills an editable draft. The visitor separately continues the intake.

Ordinary uploads use Google. For an approved firm, set `SCREEN_TRANSCRIPTION_AI_PROVIDER=openai`, place the database UUID in `SCREEN_TRANSCRIPTION_OPENAI_FIRM_IDS` and configure `SCREEN_TRANSCRIPTION_SIGNING_SECRET` as an independent server secret of at least 32 bytes. The CaseLoad project key must have audio transcription access. Approved widgets offer an unchecked OpenAI choice before recording. The server verifies a signed 30-minute offer, current enrollment and the visitor’s explicit provider choice before forwarding audio. The project’s model defaults to `gpt-transcribe` and accepts `SCREEN_OPENAI_TRANSCRIPTION_MODEL`.

An expired or withdrawn offer asks the visitor to refresh or type their answer. Closing the widget during recording discards the unfinished recording. The transcription handler forwards the recording transiently and returns text. Before enrolling a named firm, the operator needs its approval for sending visitor audio under the CaseLoad project’s actual audio-endpoint retention and processing-region terms, and for its recording notice. The Responses client’s per-call storage choice applies to a different endpoint. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

## Phone intake and text processing

GoHighLevel Voice AI transcribes its calls upstream. `/api/voice-intake` reads the provider’s call log or existing webhook transcript fields. The separately signed `/api/integrations/voice-screen/calls` route also receives a GoHighLevel call-end event with text. Changing speech recognition for telephone calls requires an upstream provider change and access to permitted audio. Neither route uses the browser transcription setting.

The operational `SCREEN_INTAKE_AI_PROVIDER` switch covers downstream slot extraction, ambiguous option mapping and voice branch classification wherever those helpers run. That includes messaging intake and some operator recovery paths. Switching it is broader than enabling a single firm or a browser microphone. Web conversations in `IntakeControllerV2` separately call `/api/screen`, which uses the Google-compatible client and retains its own OpenRouter fallback. `/api/intake-v2` persists submitted briefs and applies its existing server checks. The public SCREEN demo has its own provider selection.

Before a private text pilot, scope the selected entry points to an approved firm, validate fictional transcripts against the full engine including uncertainty, routing and emergency signals, and keep operator review for consequential decisions. The recording option above addresses transcription only.
