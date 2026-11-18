# Assisted writing staff replay

Run these commands from the app checkout with its dependencies installed. The first validates the same 30 fictional inputs used in the November 17 evaluation. The second runs offline tests, including a full Best Case generation followed by a repair and validation of the assembled report.

```sh
node --conditions=react-server --import tsx scripts/evaluate-assisted-writing/run.cjs check
node --conditions=react-server --import tsx --test scripts/evaluate-assisted-writing/offline.test.cjs
```

The capture command makes real provider requests. Run it in a staff process with the approved provider credential in its environment and an explicit spend allowance. It accepts `openai` or `gemini`, followed by `why`, `best` or `both`, a new output directory, and optionally the first and last case numbers from 1 to 30. It processes one operation at a time and stops after the first failed operation. Earlier results remain on disk.

```sh
node --conditions=react-server --import tsx scripts/evaluate-assisted-writing/run.cjs capture openai best /tmp/best-case-staff-run 1 30
```

Each case contains the source facts, a stable input hash, every model attempt with visible output, HTTP status, usage and latency, and the app’s complete validated result. Attempt order preserves initial responses and repairs. The `best` mode exercises both interview clarification and blueprint generation. Transfer the results to the authorized staff evidence location before disposing of an ephemeral runner. Use the input hash to pair the two providers and hide provider metadata from the reviewer.
