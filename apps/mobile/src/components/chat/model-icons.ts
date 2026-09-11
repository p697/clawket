export type ModelIconInput = {
  id?: string | null;
  name?: string | null;
  provider?: string | null;
};

const icons = {
  openai: require('../../../assets/model-icons/select_model_chatgpt.png'),
  anthropic: require('../../../assets/model-icons/select_model_claude.png'),
  google: require('../../../assets/model-icons/select_model_gemini.png'),
  deepseek: require('../../../assets/model-icons/select_model_deepseek.png'),
  qwen: require('../../../assets/model-icons/select_model_qwen.png'),
  xai: require('../../../assets/model-icons/select_model_grok.png'),
  moonshot: require('../../../assets/model-icons/select_model_kimi.png'),
  minimax: require('../../../assets/model-icons/select_model_minimax.png'),
  zhipu: require('../../../assets/model-icons/zhipuai.png'),
} as const;

type Manufacturer = keyof typeof icons;
const providers: Record<string, Manufacturer> = {
  openai: 'openai', 'openai-codex': 'openai', 'azure-openai': 'openai',
  anthropic: 'anthropic', google: 'google', 'google-gemini-cli': 'google',
  deepseek: 'deepseek', qwen: 'qwen', 'qwen-portal': 'qwen',
  xai: 'xai', 'x-ai': 'xai', moonshot: 'moonshot', 'moonshotai': 'moonshot',
  kimi: 'moonshot', 'kimi-coding': 'moonshot', minimax: 'minimax',
  'minimax-cn': 'minimax', 'minimax-portal': 'minimax',
  zhipu: 'zhipu', zhipuai: 'zhipu', zai: 'zhipu', 'z-ai': 'zhipu',
};

// Anchored families avoid accidental matches in arbitrary aliases (e.g. my-gpt).
const families: readonly [Manufacturer, RegExp][] = [
  ['openai', /^(?:gpt(?:[-\s]?\d|[-\s]oss\b)|chatgpt(?:[-\s]|$)|o[134](?:[-\s]|$))/],
  ['anthropic', /^(?:(?:(?:us|eu|apac|global)\.)?anthropic\.)?claude(?:[-\s]|$)/],
  ['google', /^(?:gemini|gemma)(?:[-\s]|\d|$)/],
  ['deepseek', /^deepseek(?:[-\s.]|$)/],
  ['qwen', /^qwen(?:[-\s]|\d|$)/],
  ['xai', /^grok(?:[-\s]|\d|$)/],
  ['moonshot', /^(?:kimi|moonshot)(?:[-\s]|$)/],
  ['minimax', /^minimax(?:[-\s.]|$)/],
  ['zhipu', /^glm(?:[-\s]|\d|$)/],
];
const providerBrand = (value: string): Manufacturer | undefined => (
  Object.prototype.hasOwnProperty.call(providers, value) ? providers[value] : undefined
);
const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase();

export function resolveModelManufacturer(model: ModelIconInput): Manufacturer | null {
  const id = normalize(model.id);
  const segments = id.split('/');
  const modelToken = normalize(segments.at(-1));
  const idBrand = families.find(([, pattern]) => pattern.test(modelToken))?.[0];
  if (idBrand) return idBrand;

  // Names are weaker evidence. Conflicting names or explicit namespaces are ambiguous.
  const nameBrand = families.find(([, pattern]) => pattern.test(normalize(model.name)))?.[0];
  const namespace = segments.length > 1 ? providerBrand(segments.at(-2)!) : undefined;
  const provider = providerBrand(normalize(model.provider));
  const candidates = new Set([nameBrand, namespace, provider].filter(Boolean));
  return candidates.size === 1 ? [...candidates][0]! : null;
}

export function resolveModelIconSource(model: ModelIconInput) {
  const manufacturer = resolveModelManufacturer(model);
  return manufacturer ? icons[manufacturer] : null;
}
