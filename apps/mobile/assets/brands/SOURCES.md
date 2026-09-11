# Platform identity assets

Copied without recoloring or redrawing on 2026-09-06. These marks identify the connected products, not Clawket UI chrome; ownership remains with the respective brands.

- `openclaw.png`: OpenClaw official checkout `ui/public/apple-touch-icon.png`, https://github.com/openclaw/openclaw .
- `hermes.png`: Hermes Agent official checkout `apps/desktop/public/apple-touch-icon.png`, https://github.com/NousResearch/hermes-agent . The official app artwork has a built-in rounded shape and safe area. Render that intact; the website logo has a baked-in black frame and must not be substituted.
- `youmind.png`: YouMind mobile reference checkout `apps/mobile/assets/favicon.png`, supplied locally by the product owner. Public product: https://youmind.com .

`hermes.png` and `youmind.png` were downscaled in place from 1024×1024 to 192×192 on 2026-09-11 (`sips -z 192 192`, no recoloring or cropping). `PlatformMark` renders these marks at most 52 points (156 px at 3×), so the original 1024 px / 541 KB Hermes artwork only added decode latency and memory; keep bundled marks at or near 192 px and re-downscale if an upstream asset is refreshed.

Static Metro assets are rendered by `PlatformMark`. Do not fetch brand images during onboarding or apply the user's accent color to them.
