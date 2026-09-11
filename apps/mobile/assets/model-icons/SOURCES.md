# Model manufacturer artwork

Copied unchanged at the owner’s request on 2026-09-07 from the read-only YouMind Mobile reference: `youmind-mobile/apps/mobile/assets/model-icons/`.

| Files | Manufacturer / model brand |
|---|---|
| `select_model_chatgpt.png` | OpenAI |
| `select_model_claude.png` | Anthropic / Claude |
| `select_model_gemini.png` | Google / Gemini |
| `select_model_deepseek.png` | DeepSeek |
| `select_model_qwen.png` | Alibaba / Qwen |
| `select_model_grok.png` | xAI / Grok |
| `select_model_kimi.png` | Moonshot / Kimi |
| `select_model_minimax.png` | MiniMax |
| `zhipuai.png` | Zhipu / GLM |

Consumed by `src/components/chat/model-icons.ts` and shared `ModelIcon` in the composer and model picker. Keep native colors and backing in light/dark appearance; no network image lookup. Only exact provider aliases or bounded recognizable model families qualify. Aggregators and arbitrary custom provider names are not manufacturer evidence. Unknown or unavailable artwork uses the theme-aware Lucide Orbit fallback. These marks identify third-party models and remain their respective owners’ artwork.
