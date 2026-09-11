# Corporate profile and Accessibility Mode evidence

These are synthetic engineering fixtures. Their simulated acceptance records test workflow transitions; they are not user, corporate-brand, assistive-technology or release acceptance.

## Corporate profiles (#78)

The PPTX, POTX, HTML and PDF workflows each imported immutable originals, selected and accepted explicit rules, mapped semantic layouts, applied the accepted profile, froze a Version, and built independent HTML and editable PPTX outputs. Tests also cover Review/Handoff identity, audience-variant inheritance, conflicting rules, stale decisions, tampering and contained HTML previews.

All four generated PPTX files were rendered by real Microsoft PowerPoint. The source deck was also rendered independently. Native output montages are retained for [PPTX](2026-09-11-profile-evidence/corporate-pptx-powerpoint.png), [POTX](2026-09-11-profile-evidence/corporate-potx-powerpoint.png), [HTML](2026-09-11-profile-evidence/corporate-html-powerpoint.png) and [PDF](2026-09-11-profile-evidence/corporate-pdf-powerpoint.png) inputs. [Machine evidence](2026-09-11-profile-evidence/corporate-evidence.json) records individual source/profile hashes and renderer results.

Native rendering does not establish corporate acceptance. On 2026-09-11 the maintainer confirmed that no actual corporate reference is available yet. #78 remains open for an organization-supplied reference, font/brand approval, and the remaining native master/media reuse work. The current supported-rule and format limits are described in [corporate template intake](../corporate-template-intake.md).

## Accessibility Mode (#81)

The final three-page fixture declares `en-CA`, left-to-right text and 150% text scaling. HTML contains real semantic metadata and keyboard controls; PPTX retains editable text, language and image descriptions with automatic shrinking disabled. Microsoft PowerPoint rendered all three slides. The [native montage](2026-09-11-profile-evidence/accessibility-powerpoint.png) and [HTML page](2026-09-11-profile-evidence/accessibility-html.png) show the inspected output; this observation does not replace a human accessibility review.

Exact final artifact identities:

- HTML: `a20458ec11ed4e1b6516bd4ff2affb6ea4fd30a525aa0f8d5e22ec543dde80bf`.
- PPTX: `07276e9a289341d00fab60987d6be93a3a101057e0e45ab0956b6ba98b0b1e22`.
- Semantic source revision: `f7dd2bff910c1e9963b73d8fc7b7785a354335a6e20370bd138a2457b9b0a865`.

The actual artifact audit returned `needs_review`: boundary contrast needs human inspection on pages 1 and 3, and native PowerPoint drawing order differs from the declared title-first order on those pages. HTML and PPTX reading-order evidence are independent. These four findings remain in the [machine report](2026-09-11-profile-evidence/accessibility-evidence.json).

Golden regression workflows cover accessible creation, read-only external HTML and immutable Build audits, accepted page-scoped remediation with sibling/frozen-output preservation, stale-audit rejection, large-text overflow rejection, actual Chromium keyboard interaction, editable PPTX metadata, RTL properties, and Review/Handoff report integrity. The full local suite passed 240 tests with no failures or skips; the final CLI audit addition was verified by the focused accessibility suite and is also covered by CI.

Assistive-technology testing, the real PowerPoint Accessibility Checker, human accessibility review, organization approval and legal/policy conformance stay pending or unclaimed. Independent native assistive reading order/decorative flags, full native chart/table/media alternatives and tagged PDF remain explicit capability limits. See [Accessibility Mode](../accessibility-mode.md).

## Retained local evidence and release boundary

The complete synthetic projects, immutable builds, sources, native PDFs and screenshots are retained in the protected local project area at `acceptance/queue-closeout-20260911/`. The small reports and previews above are committed for review. No supplied corporate files or private project content are included.

The V1.0 readiness checker still rejects release because human visual acceptance, final native PowerPoint acceptance, delivery-package acceptance and three independent target-user trials are incomplete. #21 and its parent #13 remain open; successful tests and native rendering do not satisfy those gates.
