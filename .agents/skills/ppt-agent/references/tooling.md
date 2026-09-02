# Tooling decisions

## Adopted foundation

- `gitbrent/PptxGenJS` (MIT): native OOXML authoring from Node. Use it for editable text, shapes, images, tables, charts, slide masters, and speaker notes.
- PPT-Ops Source Intake: the default local Markdown, DOCX, and PPTX extractor because it already enforces file signatures, Open XML structure, archive limits, hashes, deduplication, and source locators.

## Optional adapters

- `microsoft/markitdown` (MIT): consider as an optional import adapter when PDF, XLSX, or additional Office formats are requested. Do not enable cloud OCR or LLM clients implicitly; disclose outbound processing first.
- OpenAI's curated `slides` skill (Apache-2.0): use its design and QA patterns as upstream reference, especially editable PptxGenJS authoring, rasterized inspection, overflow tests, montage generation, and font checks. Do not vendor it blindly or replace PPT-Ops contracts.

## Rejected as the V1 core

- Presenton: useful as a separate application/API, but its browser/Electron product, Python/Next.js stack, authentication, and provider runtime duplicate the Codex-agent product boundary.
- Browser-first preview/editing systems: they may inspire QA tooling, but they are not the product interface.

Add a dependency only when it closes a demonstrated capability gap and its license, maintenance, privacy behavior, and failure modes have been reviewed.
