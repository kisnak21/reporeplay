# Accessibility audit — RepoReplay

WCAG 2.2 Level AA · WCAG-EM method · 5 pages/states sampled · 2026-09-13

## Scope

- Target: local RepoReplay web application, including import, repository history, processing, commit evidence, and the case study.
- Technology: Next.js 16.3.3, React 19, Tailwind CSS 4; Chromium 151.
- Accessibility baseline for a human pass: keyboard-only; NVDA with Chrome or Firefox; VoiceOver with Safari; mobile screen reader; native 200%/400% browser zoom; forced-colors/high-contrast mode.
- Automated evaluation used Playwright with the locally installed axe-core 4.13.0. The AccessLint CLI, configuration, and browser connection were unavailable, so this is an axe fallback and not an AccessLint scan.
- No screen reader, touch device, or native browser zoom was available. Browser font-size overrides and simulated text-spacing CSS are evidence leads only.

## Sample

- Structured: / — public import form and mocked invalid-URL error.
- Structured: /repositories/demo — repository overview, timeline filters, no-results state, and long warning path.
- Structured: /repositories/audit-repo/processing/audit-run — mocked failed refresh and retry state.
- Structured: /repositories/demo/commits/9d8e7f6 — route-addressable commit evidence drawer, including keyboard-scrollable tables.
- Random: /case-study — content page with a separate layout and long heading.

## Evaluation evidence

- axe-core reported zero violations on each of the five sampled routes at 1280px and 320px. The mocked failed-processing state also had zero violations at both widths after the semantic list change.
- axe-core marked nine color-contrast nodes incomplete on the 320px commit-evidence page. Those values still need visual review; incomplete is not a pass.
- Keyboard/E2E checks cover skip navigation, form validation, filters, empty results, the retry action, drawer focus entry and wrapping, Escape, and return to the triggering timeline link.
- Page-level horizontal overflow is absent at 320px across the sample. The commit evidence tables remain horizontally scrollable inside named, focusable regions; Arrow keys move the table at mobile width.
- The WCAG text-spacing override produces no document overflow on the five static sample routes at 320px.
- A 200% root-font-size override produces no document overflow on the sample at 320px. This is not a substitute for native text resizing or browser zoom.
- The import URL input border measures 3.98:1 against its fill after the shared border token was raised. Other non-text states, especially evidence-table borders, remain in the contrast handoff.
- Processing steps now expose an ordered list; retry and filter-result changes retain programmatic status semantics. Their real announcements still need assistive-technology confirmation.
- No animation or moving content was found in the sampled routes or global styles. Reduced-motion behavior was therefore not applicable to these states.
- Next.js development controls can overlap local development screenshots; final mobile inspection should use a production build.

## Conformance ledger

For the 35 criteria recorded in this sampled evaluation: **Pass: 19 · Fail: 0 · Undetermined: 7 · N/A: 9**. This is not a product-wide conformance claim; every other WCAG 2.2 A/AA criterion remains undetermined because it was not exercised.

- Pass: 1.3.1, 1.3.2, 1.4.1, 1.4.10, 1.4.12, 2.1.1, 2.1.2, 2.4.1, 2.4.2, 2.4.3, 2.4.4, 2.4.6, 2.4.7, 2.5.3, 2.5.8, 3.1.1, 3.3.1, 3.3.2, 4.1.2.
- Fail: none remains in the exercised sample after remediation.
- Undetermined: 1.4.3, 1.4.4, 1.4.11, 2.4.11, 3.2.3, 3.2.4, 4.1.3.
- N/A for the sample: 1.2.1–1.2.5 (no media), 2.5.1, 2.5.4, 2.5.7 (no path gestures, motion actuation, or dragging).

## Remediation verified

- Added descriptive document titles to the import, case-study, repository, processing, and commit pages.
- Kept keyboard focus inside the modal drawer, returned focus to the timeline link after close, and preserved focus when retry changes into cancel.
- Exposed empty-filter results as a polite status and processing steps as an ordered list.
- Raised the shared control-border contrast and wrapped long headings, identifiers, and repository details at narrow widths.
- Added E2E regression checks for focus behavior, page titles, text spacing, 200% text-size reflow, and form-control contrast.

## Human-required handoff

- Confirm status and alert announcements on the import error, filtered empty state, failed processing run, retry transition, and commit drawer with NVDA + Chrome/Firefox and VoiceOver + Safari.
- Inspect focus and reading order, dialog/table announcements, and the keyboard-scrollable evidence tables with those screen readers.
- Test native 200%/400% zoom, text-only resizing, forced colors, and orientation changes.
- Review contrast for evidence-table text, focus rings, status indicators, borders, and warnings in production-rendered states.
- Wire a supported AccessLint or axe command into CI with stable source mapping; the local AccessLint scan was not available in this audit.
