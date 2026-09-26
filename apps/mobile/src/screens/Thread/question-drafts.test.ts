import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadQuestionDraft, saveQuestionDraft, removeQuestionDraft } from './question-drafts';
beforeEach(() => {
  const values = new Map<string, string>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => values.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => { values.set(key, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async key => { values.delete(key); });
});
it('serializes rapid edits and resolution so stale writes cannot resurrect an answer', async () => {
  const key = 'connection:session:resolved';
  await Promise.all([saveQuestionDraft(key, { a: ['first'] }), saveQuestionDraft(key, { a: ['final exact text'] })]);
  expect(await loadQuestionDraft(key)).toEqual({ a: ['final exact text'] });
  await Promise.all([saveQuestionDraft(key, { a: ['queued'] }), removeQuestionDraft(key), saveQuestionDraft(key, { a: ['late'] })]);
  expect(await loadQuestionDraft(key)).toBeUndefined();
});
it('bounds retained drafts and rejects malformed or expired storage', async () => {
  for (let i = 0; i < 35; i++) await saveQuestionDraft(`q${i}`, { a: ['answer'] });
  expect(await loadQuestionDraft('q0')).toBeUndefined();
  expect(await loadQuestionDraft('q34')).toEqual({ a: ['answer'] });
  await AsyncStorage.setItem('clawket.question-drafts.v2', JSON.stringify([{key:'bad',updatedAt:Date.now(),answers:{a:42}}, {key:'old',updatedAt:1,answers:{a:['private']}}]));
  expect(await loadQuestionDraft('bad')).toBeUndefined();
  expect(await loadQuestionDraft('old')).toBeUndefined();
});
it('restores every multi-selection and preserves a deliberately cleared incomplete answer', async () => {
  await saveQuestionDraft('multi', { q0: ['Unit', 'Integration'], q1: [] });
  expect(await loadQuestionDraft('multi')).toEqual({ q0: ['Unit', 'Integration'], q1: [] });
});
