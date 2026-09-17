# Bundled Agent avatar assets

- `youmind-sprite-default.png`: default YouMind Sprite avatar, 500×500, supplied locally by the product owner on 2026-09-17 (original file `IMG_1813.png`). Bundled as-is, no recoloring or cropping.

The YouMind Sprite adapter emits the bundled sentinel URI (`resolveYouMindSpriteAvatarUrl` in `src/connection/adapters/youmind-sprite-avatar.ts`) whenever the Sprite has no custom avatar configured on YouMind, including when the server reports its own placeholder artwork (`/assets/sprite_default_static.png`, `/assets/sprite_default_avator.jpg`). `resolveAgentAvatarImageSource` in `src/utils/agent-avatar-uri.ts` maps that sentinel to this file at render time, so the roster cache stays build-independent and never persists a Metro or bundle path.
