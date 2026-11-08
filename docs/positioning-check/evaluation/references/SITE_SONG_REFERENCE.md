# Blind capture reference: Song Criminal Defence (`site_song`)

**Reference locked before model output.** No model output was read for this case. This packet does not contain usable positioning evidence, so no element scores or accuracy denominator are assigned.

- Packet: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_song.json`
- Submitted URL: https://www.songcriminaldefence.com/; captured 2026-11-08T16:30:51Z.
- Capture records one page as `readable` but retained text is 0 characters; evidence array is empty. Both screenshots are unavailable/unanalysed. The packet also states fewer than three substantial pages were readable. The zero text conflicts with the page's `readable` label; functionally this is an empty/unassessable capture.
- Expected behavior for this test: no Gemini analysis call; return a clear unreadable/insufficient-evidence state, not an invented profile, all-zero scores, or a fabricated `not_observed` finding. No claim about the actual firm is possible from this packet.

This is a capture/availability fixture, not an accuracy score. Correct the page-state inconsistency in the fixture/pipeline before relying on it as a clean representation of the website.
