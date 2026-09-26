import AsyncStorage from '@react-native-async-storage/async-storage';

export type QuestionAnswers = Record<string, string[]>;
const STORE = 'clawket.question-drafts.v2';
const MAX_BYTES = 256000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
type Draft = { key: string; updatedAt: number; answers: QuestionAnswers };
let queue: Promise<unknown> = Promise.resolve();
const retired = new Set<string>();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work); queue = next.catch(() => {}); return next;
}
function validAnswers(value: unknown): value is QuestionAnswers {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).length <= 32
    && Object.entries(value).every(([id, v]) => !['__proto__', 'constructor', 'prototype'].includes(id) && Array.isArray(v) && v.length <= 32 && v.every(item => typeof item === 'string' && item.length <= 64000));
}
async function read(): Promise<Draft[]> {
  const raw = await AsyncStorage.getItem(STORE);
  if (!raw || raw.length > MAX_BYTES) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((d): d is Draft => !!d && typeof d.key === 'string' && Number.isFinite(d.updatedAt) && d.updatedAt > Date.now() - MAX_AGE && d.updatedAt <= Date.now() && validAnswers(d.answers)).slice(-32) : [];
  } catch { return []; }
}
export function loadQuestionDraft(key: string): Promise<QuestionAnswers | undefined> {
  return serial(async () => retired.has(key) ? undefined : (await read()).find(d => d.key === key)?.answers);
}
export function saveQuestionDraft(key: string, answers: QuestionAnswers): Promise<void> {
  // Snapshot now; queued writes must not observe a later mutable React draft.
  const snapshot = JSON.parse(JSON.stringify(answers));
  return serial(async () => {
    if (retired.has(key) || !validAnswers(snapshot)) return;
    const drafts = (await read()).filter(d => d.key !== key);
    drafts.push({ key, updatedAt: Date.now(), answers: snapshot });
    while (drafts.length > 32 || JSON.stringify(drafts).length > MAX_BYTES) drafts.shift();
    await AsyncStorage.setItem(STORE, JSON.stringify(drafts));
  });
}
export function removeQuestionDraft(key: string): Promise<void> {
  retired.add(key);
  if (retired.size > 128) retired.delete(retired.values().next().value!);
  return serial(async () => {
    await AsyncStorage.setItem(STORE, JSON.stringify((await read()).filter(d => d.key !== key)));
    await AsyncStorage.removeItem(`clawket.question-draft.v1:${key}`);
  });
}
