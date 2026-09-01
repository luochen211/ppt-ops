# ADR 0003: Source intake, references, and deduplication

- Status: Accepted
- Date: 2026-09-01

## Decision

Markdown, DOCX, and PPTX enter the system through one bounded intake service. The service verifies extension/signature/package structure, computes SHA-256 before persistence, and deduplicates within a project by content hash. Original bytes are copied once to `.pptops/sources/<sha256>/` and never edited.

Extraction produces normalized text plus stable source locators: line ranges for Markdown, paragraph indexes for DOCX, and slide/text indexes for PPTX. Manual corrections create a new extraction revision and a new Source metadata revision while retaining the original bytes and earlier extraction.

Open XML archives are rejected for unsafe paths, excessive entry count, oversized entries, excessive expanded size, CRC failure, or a mismatched package root. The parser never extracts archive entries directly to user-controlled paths.

## Consequences

- Page Specs and AI candidates can cite the exact imported location.
- Reimporting identical content is observable and does not create conflicting truth sources.
- Corrections are auditable without rewriting user material.
- Rich formatting and chart semantics are outside intake; T6 renderers and later adapters may consume additional normalized metadata.
