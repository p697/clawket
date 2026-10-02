import { loadQuestionDraft, saveQuestionDraft, removeQuestionDraft } from './question-drafts';
import { Circle, CircleCheck } from 'lucide-react-native';
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
import { useAppTheme } from '../../theme';
import { useChatSurfaces } from '../../components/chat/ChatPresentation';
import { WorkDock } from '../../components/chat/WorkDock';
import { EMPTY_TURN_WORK } from '../../components/chat/turn-work';
import { FontSize, LineHeight, Space, IconSize, Radius, HitSize, BorderWidth } from '../../theme/tokens';

const QUESTION_PHASE = { kind: 'question' } as const;

/**
 * Pending questions survive route changes through the adapter snapshot.
 * Dismissal never answers implicitly. While one waits it holds the work
 * dock's place above the composer in the dock's amber "your turn" look (tool
 * process design C, owner decision 2026-10-02); tapping it opens the answer.
 */
export function AgentQuestions({ adapter, sessionKey, onPendingChange }: {
  adapter: AgentAdapter;
  sessionKey: string;
  /** Whether a question is waiting, so the work dock can make way. */
  onPendingChange?: (pending: boolean) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { wallpaper } = useChatSurfaces();
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const draftTouched = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const question = questions[0];
  const lastQuestion = useRef<AgentQuestion | undefined>(undefined);
  if (question) lastQuestion.current = question;
  const displayedQuestion = question ?? lastQuestion.current;
  const hasQuestion = Boolean(question) && Boolean(adapter.questions);
  useEffect(() => { onPendingChange?.(hasQuestion); }, [hasQuestion, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
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
  useEffect(() => {
    let alive = true;
    draftTouched.current = false;
    setDraft(question?.prefill ?? ''); setSelection(null); setFailed(false);
    if (!question) setVisible(false);
    if (question && ['select', 'input', 'editor'].includes(question.kind)) {
      void loadQuestionDraft(`${adapter.connection.id}:${sessionKey}:${question.id}`).then(saved => {
        const value = saved?.value?.[0];
        if (!alive || draftTouched.current || value === undefined) return;
        if (question.kind === 'select') {
          if (question.options?.includes(value)) setSelection(value);
        } else setDraft(value);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [question?.id, adapter.connection.id, sessionKey]);
  const writeDraft = (value: string) => {
    if (!question) return;
    draftTouched.current = true;
    if (question.kind === 'select') setSelection(value); else setDraft(value);
    void saveQuestionDraft(`${adapter.connection.id}:${sessionKey}:${question.id}`, { value: [value] }).catch(() => {});
  };
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
  const openAnswer = () => { Keyboard.dismiss(); setVisible(true); };
  const asked = question ? (question.kind === 'form'
    ? question.fields?.map(f => f.header || f.title).filter(Boolean).join(' · ')
    : question.title) : undefined;
  const pending = question ? <WorkDock testID="agent-question-pending" phase={QUESTION_PHASE} work={EMPTY_TURN_WORK} detail={asked}
    appearance={wallpaper === 'plain' ? 'surface' : 'glass'} onExpand={openAnswer} onAttend={openAnswer} /> : null;
  if (displayedQuestion?.kind === 'form') return <>
    {pending}
    <StructuredQuestionForm question={displayedQuestion} visible={visible && !!question} scope={`${adapter.connection.id}:${sessionKey}`} saving={saving} failed={failed} onClose={() => { if (!busy.current) setVisible(false); }} onSubmit={submit} />
  </>;
  const compact = displayedQuestion?.kind !== 'editor'
    && (displayedQuestion?.message?.length ?? 0) < 800
    && (displayedQuestion?.options?.length ?? 0) <= 6
    && (displayedQuestion?.options ?? []).every(option => option.length < 120);
  const Body = compact ? View : BottomSheetScrollView;
  return <>
    {pending}
    <Sheet visible={visible && !!question} onClose={() => { if (!busy.current) setVisible(false); }} title={displayedQuestion?.title ?? ''}
      closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={compact ? undefined : ['55%', '85%']} androidKeyboardInputMode="adjustPan" testID="agent-question-sheet"
      footer={<View style={styles.actions}>
        <Button label={t('Cancel', { ns: 'common' })} variant="secondary" disabled={saving} onPress={() => { void submit({ cancelled: true }); }} />
        {displayedQuestion?.kind === 'confirm' ? <>
          <Button label={t('No', { ns: 'common' })} variant="secondary" disabled={saving} onPress={() => { void submit({ confirmed: false }); }} />
          <Button label={t('Yes', { ns: 'common' })} disabled={saving} onPress={() => { void submit({ confirmed: true }); }} />
        </> : <Button label={t('Send')} loading={saving} disabled={saving || (displayedQuestion?.kind === 'select' && selection === null)} onPress={() => { if (displayedQuestion?.kind === 'select' && selection === null) return; void submit({ value: displayedQuestion?.kind === 'select' ? selection! : draft }); }} />}
      </View>}>
      <Body {...(compact ? { style: styles.body } : { contentContainerStyle: styles.body, keyboardShouldPersistTaps: 'handled' as const })}>
        {displayedQuestion?.message ? <Text selectable style={[styles.text, { color: theme.colors.ink }]}>{displayedQuestion?.message}</Text> : null}
        {displayedQuestion?.kind === 'select' ? <View style={styles.choices}>{displayedQuestion.options?.map((option, i) => {
          const selected = selection === option;
          const Icon = selected ? CircleCheck : Circle;
          return <Pressable key={`${i}:${option}`} accessibilityRole="radio" accessibilityLabel={option} accessibilityState={{ checked: selected, disabled: saving }} disabled={saving}
            testID={`agent-question-option-${i}`} onPress={() => writeDraft(option)}
            style={({ pressed }) => [styles.choice, { backgroundColor: selected || pressed ? theme.colors.surface : theme.colors.canvas, borderColor: selected ? theme.colors.ink : theme.colors.line }]}>
            <Text style={[styles.optionLabel, styles.text, { color: theme.colors.ink }]}>{option}</Text>
            <Icon size={IconSize.md} color={selected ? theme.colors.ink : theme.colors.inkTertiary} />
          </Pressable>;
        })}</View> : null}
        {displayedQuestion?.kind === 'input' || displayedQuestion?.kind === 'editor' ? <FormTextInput bottomSheet value={draft} onChangeText={writeDraft} placeholder={displayedQuestion?.placeholder} multiline={displayedQuestion?.kind === 'editor'} editable={!saving} maxLength={64000} testID="agent-question-input" /> : null}
        {failed ? <Banner tone="bad" message={t('Could not update this request. Try again.')} /> : null}
      </Body>
    </Sheet>
  </>;
}
const styles = StyleSheet.create({ choices: { gap: Space.md }, choice: { minHeight: HitSize.lg, padding: Space.lg, borderRadius: Radius.card, borderWidth: BorderWidth.strong, flexDirection: 'row', alignItems: 'center', gap: Space.md }, optionLabel: { flex: 1 }, body: { paddingHorizontal: Space.lg, paddingBottom: Space.lg, gap: Space.lg }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, justifyContent: 'flex-end' }, text: { fontSize: FontSize.body, lineHeight: LineHeight.body } });
