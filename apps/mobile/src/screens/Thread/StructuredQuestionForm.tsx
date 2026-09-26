import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Circle, CircleCheck, Square, SquareCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { AgentQuestion } from '@clawket/agent-protocol';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space, IconSize, Radius, BorderWidth, HitSize } from '../../theme/tokens';
import { loadQuestionDraft, saveQuestionDraft, type QuestionAnswers } from './question-drafts';

export function StructuredQuestionForm({ question, visible, scope, saving, failed, onClose, onSubmit }: {
  question: AgentQuestion; visible: boolean; scope: string; saving: boolean; failed: boolean;
  onClose(): void; onSubmit(answer: { answers?: QuestionAnswers; cancelled?: boolean }): Promise<void>;
}): React.JSX.Element {
  const { theme } = useAppTheme(); const { t } = useTranslation('chat');
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const touched = useRef(false);
  const latestAnswers = useRef<QuestionAnswers>({});
  const key = `${scope}:${question.id}`;
  const fields = question.fields ?? []; const field = fields[index];
  useEffect(() => {
    let alive = true; touched.current = false; latestAnswers.current = {}; setAnswers({}); setCustom({}); setIndex(0);
    void loadQuestionDraft(key).then(value => {
      if (alive && !touched.current && value) { latestAnswers.current = value; setAnswers(value); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  const write = (value: string | string[]) => {
    if (!field) return;
    touched.current = true;
    const next = { ...latestAnswers.current, [field.id]: Array.isArray(value) ? value : [value] }; latestAnswers.current = next; setAnswers(next);
    void saveQuestionDraft(key, next).catch(() => {});
  };
  const selectedValues = field ? answers[field.id] ?? [] : [];
  const value = selectedValues[0];
  const ownAnswer = !!field && (custom[field.id] || !field.options.length || (value !== undefined && !field.options.some(o => o.label === value)));
  const complete = fields.length > 0 && fields.every(f => answers[f.id]?.length && answers[f.id].every(value => value.trim()));
  const choice = (selected: boolean) => {
    const Icon = field?.multiSelect ? (selected ? SquareCheck : Square) : (selected ? CircleCheck : Circle);
    return <Icon size={IconSize.md} color={selected ? theme.colors.ink : theme.colors.inkTertiary} />;
  };
  return <Sheet visible={visible} onClose={onClose} title={field?.header || t('Agent needs your input')}
    closeAccessibilityLabel={t('Close', { ns: 'common' })} snapPoints={['75%', '90%']} androidKeyboardInputMode="adjustPan" testID="codex-question-sheet"
    footer={<View style={styles.actions}>
      {index > 0 ? <Button label={t('Back', { ns: 'common' })} variant="ghost" disabled={saving} onPress={() => setIndex(i => i - 1)} /> : null}
      <Button style={styles.primary} label={index < fields.length - 1 ? t('Next', { ns: 'common' }) : t('Send')} disabled={saving || (index < fields.length - 1 ? !value?.trim() : !complete)} loading={saving}
        onPress={() => { if (index < fields.length - 1) setIndex(i => i + 1); else void onSubmit({ answers }); }} />
    </View>}>
    <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        {fields.length > 1 ? <Text style={[styles.secondary, { color: theme.colors.inkSecondary }]}>{t('Question {{current}} of {{total}}', { current: index + 1, total: fields.length })}</Text> : null}
        <Text style={[styles.question, { color: theme.colors.ink }]}>{field?.title}</Text>
      </View>
      {field?.options.length ? <View style={styles.choices}>{field.options.map((o, i) => {
        const selected = !ownAnswer && selectedValues.includes(o.label);
        return <Pressable key={o.label} accessibilityRole={field.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected, disabled: saving }} disabled={saving} style={({ pressed }) => [styles.choice, { backgroundColor: selected || pressed ? theme.colors.surface : theme.colors.canvas, borderColor: selected ? theme.colors.ink : theme.colors.line }]} testID={`codex-question-option-${i}`}
          accessibilityLabel={[o.label, o.description].filter(Boolean).join('. ')} onPress={() => {
            const current = (latestAnswers.current[field.id] ?? []).filter(value => field.options.some(option => option.label === value));
            setCustom(v => ({ ...v, [field.id]: false }));
            write(field.multiSelect ? (current.includes(o.label) ? current.filter(value => value !== o.label) : [...current, o.label]) : o.label);
          }}>
          <View style={styles.option}><View style={styles.optionCopy}><Text style={[styles.label, { color: theme.colors.ink }]}>{o.label}</Text>{o.description ? <Text style={[styles.secondary, { color: theme.colors.inkSecondary }]}>{o.description}</Text> : null}</View>{choice(selected)}</View>
        </Pressable>;
      })}{field.allowCustom ? <Pressable accessibilityRole={field.multiSelect ? 'checkbox' : 'radio'} accessibilityLabel={t('Your answer')} accessibilityState={{ checked: ownAnswer, disabled: saving }} disabled={saving} style={({ pressed }) => [styles.choice, { backgroundColor: ownAnswer || pressed ? theme.colors.surface : theme.colors.canvas, borderColor: ownAnswer ? theme.colors.ink : theme.colors.line }]} testID="codex-question-custom" onPress={() => { setCustom(v => ({ ...v, [field.id]: true })); if (!ownAnswer) write(''); }}>
        <View style={styles.option}><Text style={[styles.optionCopy, styles.label, { color: theme.colors.inkSecondary }]}>{t('Your answer')}</Text>{choice(ownAnswer)}</View>
      </Pressable> : null}</View> : null}
      {field?.allowCustom && ownAnswer ? <FormTextInput bottomSheet multiline value={value ?? ''} onChangeText={write} editable={!saving} maxLength={64000} placeholder={t('Your answer')} testID="codex-question-answer" /> : null}
      {failed ? <Banner tone="bad" message={t('Could not update this request. Try again.')} /> : null}
      <View style={styles.stop}><Button label={t('Stop task')} variant="text" disabled={saving} onPress={() => { void onSubmit({ cancelled: true }); }} /></View>
    </BottomSheetScrollView>
  </Sheet>;
}
const styles = StyleSheet.create({
  choices: { gap: Space.md },
  choice: { minHeight: HitSize.lg, padding: Space.lg, borderRadius: Radius.card, borderWidth: BorderWidth.strong },
  body: { paddingHorizontal: Space.lg, paddingBottom: Space.lg, gap: Space.lg },
  heading: { gap: Space.sm, paddingTop: Space.sm },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  optionCopy: { flex: 1, gap: Space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm }, primary: { flex: 1 },
  stop: { alignItems: 'center' },
  question: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold },
  label: { fontSize: FontSize.body, lineHeight: LineHeight.body }, secondary: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
