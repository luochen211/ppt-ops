# Live boundary image acceptance and proportional placement

The maintainer requested iteration of both initial images, then explicitly accepted the displayed second attempts: “接受两张新版，继续构建”. Subsequent feedback identified placement distortion, not an image defect: images may leave whitespace and need not fill the page.

Both edits used the built-in ImageGen tool with the previous immutable generation as the edit reference. Original images remain unaccepted. The external edits were imported unchanged; structured briefs, parent/reference hashes, raster inspection, agent observation, user decisions and accepted registrations remain independently stored under the local `acceptance/live-boundary-20260910` project. The tool does not expose a model identifier, so evidence records `not-exposed-by-tool`.

| Page | Accepted generation | Accepted image SHA-256 |
|---|---|---|
| First | `visual-generation-beff5f3e-4bf5-42f6-9a10-9ab9ef3e77cc` | `a96b74bbea689a14708bd2979bc3562f36b657d77d5b461a937eb7ba59db2c9b` |
| Final | `visual-generation-270949c2-bffb-4e6e-8154-0dea40e4ad39` | `3734f5b1aebd93a6fb6ffc0bd9f5ae7434aacfdffaeebbfd8239e9a8b26d7607` |

The first image shows one adult gathering sheets into an open project folder; the final image shows two adults transferring a closed folder at a desk. Both actual tool outputs were visually inspected for the subject count, action, quiet title area, reference invariants and absence of visible text/logos.

## Placement defect and repair

The generic PPTX image path supplied an unsupported sizing mode while forcing both dimensions to the container. A wide image consequently became narrow and distorted. The screenshot path already computed proportional geometry correctly.

All supported PPTX images now use measured dimensions and proportional contain/cover placement. Boundary pages use contain in both native PPTX and HTML, preserving the full image with whitespace. The original asset bytes and accepted image identities do not change. Landscape, portrait and square regression fixtures check the actual native image extents and absence of boundary cropping.

## Exact built artifact

The three-page project uses frozen `version-001` and corrected `build-002`:

- PPTX SHA-256: `0080fb1450391c0cdeb60e4cf95f0777cf25daf586e90ce665d30707042a147d`.
- HTML SHA-256: `5041ea9a35dd8a51b86e31d33f02aa778dffee935b15532ada4ce561b2b926ee`.
- Both accepted image hashes were verified in the actual PPTX media and decoded HTML embedded images.
- Microsoft PowerPoint opened the exact corrected PPTX. Computer Use inspected first and final pages at 2026-09-11 09:33 CST. Native titles were legible, image proportions were preserved and whitespace remained visible.
- The earlier build remains unchanged. Local screenshots and the matching artifact observation are under `acceptance/proportional-build-002/` within the project.

This completes the live generated-image workflow in #52. It does not fill in business acceptance, a delivery-package sign-off, or the three independent target-user trials required for GA.
