# Platform identity assets

Copied without recoloring or redrawing on 2026-09-06. These marks identify the connected products, not Clawket UI chrome; ownership remains with the respective brands.

- `openclaw.png`: OpenClaw official checkout `ui/public/apple-touch-icon.png`, https://github.com/openclaw/openclaw .
- `hermes.png`: Hermes Agent official checkout `apps/desktop/public/apple-touch-icon.png`, https://github.com/NousResearch/hermes-agent . The official app artwork has a built-in rounded shape and safe area. Render that intact; the website logo has a baked-in black frame and must not be substituted.
- `youmind.png`: YouMind mobile reference checkout `apps/mobile/assets/favicon.png`, supplied locally by the product owner. Public product: https://youmind.com .

`hermes.png` and `youmind.png` were downscaled in place from 1024×1024 to 192×192 on 2026-09-11 (`sips -z 192 192`, no recoloring or cropping). `PlatformMark` renders these marks at most 52 points (156 px at 3×), so the original 1024 px / 541 KB Hermes artwork only added decode latency and memory; keep bundled marks at or near 192 px and re-downscale if an upstream asset is refreshed.

Static Metro assets are rendered by `PlatformMark`. Do not fetch brand images during onboarding or apply the user's accent color to them.

- `pi.svg`: official Pi logo from https://pi.dev/logo-auto.svg (linked by https://github.com/earendil-works/pi/blob/v0.87.1/README.md), retrieved 2026-09-26. `pi.png` is a 192×192 transparent rasterization for the shared Metro image path, retaining the complete 800×800 viewBox, original colors, geometry and safe area. Regenerate with Sharp resize(192, 192).png(); never substitute a generic mathematical π glyph.

- `codex.png`: unmodified official Codex light app artwork from the installed OpenAI desktop distribution, `/Applications/ChatGPT.app/Contents/Resources/icon-codex-light.png`, copied 2026-09-26. Preserve the complete app artwork and safe area. Brand ownership remains with OpenAI.

- `claude-code.svg`: unmodified official Claude spark vector (fill `#D97757`, 248×248 viewBox) from the installed Claude desktop app 2.9939.2, `/Applications/Claude.app/Contents/Resources/ion-dist/assets/v1/cd02a42d9-Vq_H3mgS.svg`, copied 2026-09-26 at the owner's request: the circular-backed `../model-icons/select_model_claude.png` read as a frame on the Onboarding chooser. `claude-code.png` is a 192×192 transparent rasterization (Sharp; the complete spark scaled to 172 px and centered, original color, no backing). The model picker keeps its own Claude artwork. Brand ownership remains with Anthropic.

Local model is not a brand and has no bundled artwork: `PlatformMark` draws its Clawket-authored mark in code (`LocalModelMark`, 2026-09-26): an ink processor outline on the theme `surface` tile, on the same 42/52-point grid as the app-icon artwork, so it follows light and dark mode.
