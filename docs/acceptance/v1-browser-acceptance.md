# V1 Browser Artifact Acceptance

Recorded on 2026-09-02 against the real 54-slide release-candidate project. This validates the optional HTML output artifact, not a Web product interface and not human visual quality.

## Artifact

- Build: `build-003`, frozen Version `version-001`
- HTML SHA-256: `6869336379c2e94a29a8098e46b5ef2c018f18cd86a68e182ebbf5e3aec9cb1d`
- Slide count: 54
- Self-contained output; page content, page count, progress, previous/next controls, keyboard navigation, and Fullscreen API control are present.

## Google Chrome

- Real application: Google Chrome on the local Mac.
- Opened the generated artifact and observed slide `1 / 54` with the expected title and source-derived body.
- Entered artifact fullscreen using the new `Enter fullscreen` control; Chrome exposed `Exit fullscreen`, proving the document Fullscreen API transition rather than browser-window zoom.
- Evidence: `v1-chrome-fullscreen.jpeg`, SHA-256 `99e2d57707b1ea754fc7f3766869a52a679ce676d25fac1b9b2112b311169f9c`.

## Safari

- Real application: Safari on the local Mac, served only over `127.0.0.1` because Safari's file picker did not enable the local hidden-path HTML file.
- Opened slide `1 / 54`, entered artifact fullscreen, pressed End, and observed slide `54 / 54` with the expected final-page content and `Exit fullscreen` control.
- The loopback server was stopped immediately after the check.
- Evidence: `v1-safari-final-slide.jpeg`, SHA-256 `92dfaf6a1cf9c8c3196a2a9e01abf58ce7cf07506682a1bac6c9e72813a85a6c`.

Both browser gates pass for functional artifact interaction. Human visual acceptance remains pending.
