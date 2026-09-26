import { removeQuestionDraft } from './question-drafts';
import { ChevronRight, MessageCircleQuestion } from 'lucide-react-native';
import { StructuredQuestionForm } from './StructuredQuestionForm';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type { AgentAdapter, AgentQuestion } from '@clawket/agent-protocol';
import { Banner } from '../../components/ui/Banner';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SettingsGroup, SettingsRow } from '../../components/ui';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space, IconSize, Radius, HitSize } from '../../theme/tokens';

/** Pending questions survive route changes through the adapter snapshot. Dismissal never answers implicitly. */
export function AgentQuestions({ adapter, sessionKey }: { adapter: AgentAdapter; sessionKey: string }): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const question = questions[0];
  const lastQuestion = useRef<AgentQuestion | undefined>(undefined);
  if (question) lastQuestion.current = question;
  const displayedQuestion = question ?? lastQuestion.current;
  useEffect(() => {
    const epoch = ++generation.current;
    let revision = 0;
    const changed = new Map<string, number>();
    const resolved = new Set<string>();
    setQuestions([]); setVisible(false); setFailed(false);
    const refresh = () => {
      const before = revision;
      void adapter.questions?.list(sessionKey).then(items => {
        if (generation.current !== epoch) return;
        setQuestions(current => { const later = current.filter(q => (changed.get(q.id) ?? 0) > before); const ids = new Set(later.map(q => q.id)); return [...items.filter(q => !resolved.has(q.id) && !ids.has(q.id)), ...later]; });
      }).catch(() => {});
    };
    const offUpdate = adapter.on('update', update => {
      if (!('sessionKey' in update) || update.sessionKey !== sessionKey) return;
      if (update.type === 'question_requested') { revision++; changed.set(update.question.id, revision); setQuestions(items => [...items.filter(item => item.id !== update.question.id), update.question]); }
      if (update.type === 'question_resolved') { void removeQuestionDraft(`${adapter.connection.id}:${sessionKey}:${update.questionId}`).catch(() => {}); revision++; resolved.add(update.questionId); setQuestions(items => items.filter(item => item.id !== update.questionId)); }
    });
    const offState = adapter.on('state', state => { if (state === 'ready') refresh(); });
    refresh();
    return () => { generation.current++; offUpdate(); offState(); };
  }, [adapter, sessionKey]);
  useEffect(() => { setDraft(question?.prefill ?? ''); setFailed(false); if (!question) setVisible(false); }, [question?.id]);
  useEffect(() => {
    if (!question?.expiresAtMs) return;
    const timer = setTimeout(() => setQuestions(items => items.filter(item => item.id !== question.id)), Math.max(0, question.expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [question]);
  if (!adapter.questions) return null;
  const submit = async (answer: { value?: string; confirmed?: boolean; cancelled?: boolean; answers?: Record<string, string[]> }) => {
    if (busy.current || !question) return;
    if (adapter.state !== 'ready') { setFailed(true); return; }
    busy.current = true; setSaving(true); setFailed(false);
    const epoch = generation.current;
    try { await adapter.questions!.respond(sessionKey, question.id, answer); if (generation.current === epoch) { if (!(question.kind === 'form' && answer.cancelled)) { setQuestions(items => items.filter(item => item.id !== question.id)); void removeQuestionDraft(`${adapter.connection.id}:${sessionKey}:${question.id}`).catch(() => {}); } setVisible(false); } }
    catch { if (generation.current === epoch) setFailed(true); }
    finally { busy.current = false; if (generation.current === epoch) setSaving(false); }
  };
  if (displayedQuestion?.kind === 'form') return <>
    {question ? <Pressable accessibilityRole="button" accessibilityLabel={t('Respond')} onPress={() => { Keyboard.dismiss(); setVisible(true); }} testID="agent-question-pending" style={styles.prompt}>
      <MessageCircleQuestion size={IconSize.md} color={theme.colors.inkSecondary} />
      <Text numberOfLines={1} style={[styles.promptLabel, { color: theme.colors.ink }]}>{question.fields?.map(f => f.header).filter(Boolean).join(' · ') || t('Agent needs your input')}</Text>
      <Text style={[styles.promptAction, { color: theme.colors.inkSecondary }]}>{t('Respond')}</Text>
      <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} />
    </Pressable> : null}
    <StructuredQuestionForm question={displayedQuestion} visible={visible && !!question} scope={`${adapter.connection.id}:${sessionKey}`} saving={saving} failed={failed} onClose={() => { if (!busy.current) setVisible(false); }} onSubmit={submit} />
  </>;
  return <>
    {question ? <Banner message={t('Agent needs your input')} actionLabel={t('Respond')} onAction={() => { Keyboard.dismiss(); setVisible(true); }} testID="agent-question-pending" /> : null}
    <Sheet visible={visible && !!question} onClose={() => { if (!busy.current) setVisible(false); }} title={displayedQuestion?.title ?? ''}
      closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={['55%', '85%']} androidKeyboardInputMode="adjustPan" testID="agent-question-sheet"
      footer={<View style={styles.actions}>
        <Button label={t('Cancel', { ns: 'common' })} variant="secondary" disabled={saving} onPress={() => { void submit({ cancelled: true }); }} />
        {displayedQuestion?.kind === 'confirm' ? <>
          <Button label={t('No', { ns: 'common' })} variant="secondary" disabled={saving} onPress={() => { void submit({ confirmed: false }); }} />
          <Button label={t('Yes', { ns: 'common' })} disabled={saving} onPress={() => { void submit({ confirmed: true }); }} />
        </> : displayedQuestion?.kind !== 'select' ? <Button label={t('Send')} loading={saving} onPress={() => { void submit({ value: draft }); }} /> : null}
      </View>}>
      <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {displayedQuestion?.message ? <Text selectable style={[styles.text, { color: theme.colors.ink }]}>{displayedQuestion?.message}</Text> : null}
        {displayedQuestion?.kind === 'select' ? <SettingsGroup>{displayedQuestion?.options?.map((option, i) => <SettingsRow key={`${i}:${option}`} title={option} disabled={saving} onPress={() => { void submit({ value: option }); }} />)}</SettingsGroup> : null}
        {displayedQuestion?.kind === 'input' || displayedQuestion?.kind === 'editor' ? <FormTextInput bottomSheet value={draft} onChangeText={setDraft} placeholder={displayedQuestion?.placeholder} multiline={displayedQuestion?.kind === 'editor'} editable={!saving} maxLength={64000} testID="agent-question-input" /> : null}
        {failed ? <Banner tone="bad" message={t('Could not update this request. Try again.')} /> : null}
      </BottomSheetScrollView>
    </Sheet>
  </>;
}
const styles = StyleSheet.create({ prompt: { minHeight: HitSize.md, flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.lg, paddingVertical: Space.sm, borderRadius: Radius.card }, promptLabel: { flex: 1, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary }, promptAction: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary }, body: { paddingHorizontal: Space.lg, paddingBottom: Space.lg, gap: Space.lg }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, justifyContent: 'flex-end' }, text: { fontSize: FontSize.body, lineHeight: LineHeight.body } });
