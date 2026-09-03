# Accessibility audit baseline

Date: 2026-09-03
Target: local RepoReplay product at `http://localhost:3000`
Goal: WCAG 2.2 Level AA, using a WCAG-EM-style scope, sample, evaluation, and findings ledger.

## Scope and limitations

The audit covered the public import flow, repository overview, processing states, timeline, commit evidence drawer, and the case-study page. The target technology is the Next.js 16 / React 19 application in this repository, including client polling, retry/cancel controls, route-addressable drawers, and API-backed live states.

The automated accessibility tier used Playwright with axe-core because the repository environment did not expose a working Chrome DevTools/accesslint session. The `@accesslint/cli` scan was attempted twice, including with the locally installed Playwright Chromium binary, but Chrome debug discovery on `127.0.0.1:9222` did not complete. The axe-core results below are therefore a fallback automated baseline, not an accesslint result.

Native browser zoom, screen readers, touch hardware, and cross-browser rendering were not available in this run. The zoom result is a CSS `zoom: 2` approximation and must not be treated as proof of native 200% or 400% conformance. Human verification remains required for screen-reader announcements, focus order, contrast in every state, and mobile interaction.

## Sampled routes and states

The sample contains the landing page, deterministic showcase pages, live API-backed pages with mocked repository/timeline/commit data, a failed processing run, and the case study:

| Route | State exercised |
| --- | --- |
| `/` | import form and limits |
| `/repositories/demo` | completed showcase repository and coverage warning |
| `/repositories/demo/processing/run-demo` | processing showcase |
| `/repositories/demo/commits/9d8e7f6` | showcase commit drawer with evidence tables |
| `/repositories/audit-repo` | live repository overview, timeline, filters |
| `/repositories/audit-repo/processing/audit-run` | live `FAILED` run with retry action |
| `/repositories/audit-repo/commits/abc1234` | live commit drawer |
| `/case-study` | product explanation page |

## Evaluation evidence

- axe-core WCAG 2.0 A/AA, WCAG 2.1 AA, and WCAG 2.2 AA rules: **0 violations on all 8 sampled routes**.
- DOM checks: every sample had `lang="en"`, exactly one `main`, exactly one `h1`, no visible unnamed links/buttons/inputs/selects/summary controls, and no visible anchor without `href`.
- Keyboard proxy checks: visible tabbable controls exposed a computed `3px solid` focus outline. Existing end-to-end coverage exercises skip navigation, drawer focus entry, focus trapping, Escape close, browser Back close, retry, cancel, and validation-error presentation.
- Desktop overflow: no document overflow at the default 1280px viewport.
- 320px reflow: 7 of 8 samples had no document overflow. `/repositories/demo` overflowed to 354px because a warning path rendered in an inline `<code>` element was not allowed to wrap.
- The showcase commit evidence tables remain horizontally scrollable at 320px. This keeps the data available but requires a horizontal gesture and should be reviewed against the table/data exception and the intended mobile evidence experience.
- Text-spacing override produced overflow on `/repositories/demo` (426px) and `/case-study` (357px). CSS zoom approximation also overflowed on several samples; both results require native-browser confirmation before a formal conformance claim.
- Small-target proxy checks found inline timeline links around 16-19px high. These are inline text links and may fall under the WCAG inline-target exception, but their touch comfort should still be reviewed.

## Conformance ledger

This ledger records the evidence from this run. "Pass" is limited to the exercised implementation or deterministic DOM check; it is not a whole-product certification.

| WCAG 2.2 criterion | Status | Evidence / next action |
| --- | --- | --- |
| 1.3.1 Info and Relationships | Pass (automated/sample) | axe-core passed; landmarks, headings, labels, tables, and definition-list structure were present in sampled states. |
| 1.4.10 Reflow | Fail (verified at 320px) | `/repositories/demo` warning path reaches 354px from a 320px viewport. Remediate wrapping or responsive presentation. The evidence table scroll is tracked separately as a data-layout review. |
| 1.4.12 Text Spacing | Flagged | Text-spacing override overflowed the demo repository and case-study samples. Verify with the WCAG spacing bookmarklet/native browser and fix any content loss. |
| 2.1.1 Keyboard | Pass (exercised flows) | E2E covers skip link, drawer controls, retry/cancel, Escape, and Back. Complete a full keyboard traversal of every sampled page manually. |
| 2.1.2 No Keyboard Trap | Pass (drawer sample) | Commit drawer focus trap and Escape behavior are covered by E2E. Recheck all error/loading states manually. |
| 2.4.1 Bypass Blocks | Pass (sample) | Skip-to-content link is present and keyboard-tested. |
| 2.4.3 Focus Order | Undetermined / human required | DOM proxy did not establish a meaningful reading order for every responsive state. Traverse the full flow with keyboard and assistive technology. |
| 2.4.6 Headings and Labels | Pass (automated/sample) | axe-core and DOM checks passed; sampled pages exposed one primary heading and labelled form/filter regions. |
| 2.4.7 Focus Visible | Pass (sample) | Computed focus proxy found visible outlines on sampled tabbables. Verify contrast and appearance across panel, alert, and drawer backgrounds. |
| 2.5.3 Label in Name | Pass (automated/sample) | axe-core passed and visible control names were present in the sample. |
| 2.5.8 Target Size (Minimum) | Flagged | Inline timeline links were below 24px in height. Review the inline-link exception and increase non-inline targets where practical. |
| 3.1.1 Language of Page | Pass (sample) | All sampled documents declared `lang="en"`. |
| 4.1.2 Name, Role, Value | Pass (automated/sample) | axe-core passed; buttons, form controls, dialog, status, and alert roles were exposed in the sample. |
| 4.1.3 Status Messages | Undetermined / human required | `role="status"`, `aria-live`, and `role="alert"` are present for loading, retry, and failure states. Confirm announcement timing and wording with NVDA/VoiceOver. |
| 1.4.1 Use of Color, 1.4.11 Non-text Contrast | Undetermined / human required | Automated sample did not prove all status, focus, border, and warning contrasts or color-independent meaning. |
| 1.4.4 Resize Text | Undetermined / human required | Native 200%/400% zoom was unavailable; CSS zoom output is only a lead. |

Media, audio/video timing, drag interactions, and autoplay criteria were not applicable to the sampled product states.

## Prioritized worklist

1. Fix the verified 320px warning-path overflow in `src/app/repositories/demo/page.tsx`; apply the same safe wrapping treatment to API-backed warning paths in `src/components/live-repository-view.tsx` and `src/components/live-commit-view.tsx`.
2. Review the commit evidence table at narrow widths. Preserve access to every value while making the scroll affordance and column semantics clear, or switch to a stacked mobile evidence layout.
3. Re-run automated checks in CI and add a supported accesslint/axe command with stable source mapping.
4. Perform the human pass with keyboard-only, NVDA + Chromium/Firefox, VoiceOver + Safari, and a mobile screen reader. Include native 200%/400% zoom, reduced motion, text spacing, and 320px reflow.
5. After the a11y baseline is remediated, continue with the processing failure/error-state UX and production observability work tracked in `TASKS.md`.

## Audit disposition

The sampled implementation has a clean automated axe baseline and several verified keyboard foundations, but it is **not yet a complete WCAG 2.2 AA conformance claim**. The verified narrow-screen overflow and the outstanding human checks must be resolved before production-readiness sign-off.
