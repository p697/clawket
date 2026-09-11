import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Pin, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmationModal, FormTextInput, Sheet } from '../ui';
import { SwipeableGatewayRow, SwipeableMethods } from '../config/SwipeableGatewayRow';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { StorageService, SavedPrompt } from '../../services/storage';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelectPrompt: (text: string) => void;
};

function buildDefaultPrompts(t: (key: string) => string): SavedPrompt[] {
  return [
    { id: 'default_prompt_intro', text: t('prompt_intro'), createdAt: 0, updatedAt: 0 },
    { id: 'default_prompt_cron_status', text: t('prompt_cron_status'), createdAt: 0, updatedAt: 0 },
    { id: 'default_prompt_heartbeat', text: t('prompt_heartbeat'), createdAt: 0, updatedAt: 0 },
  ];
}

function pinPrompt(prompts: SavedPrompt[], promptId: string): SavedPrompt[] {
  const target = prompts.find((prompt) => prompt.id === promptId);
  if (!target) return prompts;
  const pinnedAt = Date.now();
  const updatedTarget = { ...target, pinnedAt, updatedAt: pinnedAt };
  const rest = prompts.filter((prompt) => prompt.id !== promptId);
  const pinned = rest.filter((prompt) => typeof prompt.pinnedAt === 'number');
  const unpinned = rest.filter((prompt) => typeof prompt.pinnedAt !== 'number');
  return [updatedTarget, ...pinned, ...unpinned];
}

function unpinPrompt(prompts: SavedPrompt[], promptId: string): SavedPrompt[] {
  const target = prompts.find((prompt) => prompt.id === promptId);
  if (!target) return prompts;
  const updatedTarget = { ...target, pinnedAt: undefined, updatedAt: Date.now() };
  const rest = prompts.filter((prompt) => prompt.id !== promptId);
  const pinned = rest.filter((prompt) => typeof prompt.pinnedAt === 'number');
  const unpinned = rest.filter((prompt) => typeof prompt.pinnedAt !== 'number');
  return [...pinned, ...unpinned, updatedTarget];
}

export function PromptPickerModal({ visible, onClose, onSelectPrompt }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Prompts')}
      maxHeight="75%"
      testID="prompt-picker-sheet"
    >
      {visible ? (
        <PromptPickerContent onClose={onClose} onSelectPrompt={onSelectPrompt} />
      ) : null}
    </Sheet>
  );
}

function PromptPickerContent({
  onClose,
  onSelectPrompt,
}: {
  onClose: () => void;
  onSelectPrompt: (text: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;

  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<SavedPrompt | null>(null);
  const [editorText, setEditorText] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Swipeable ref management — close others when one opens
  const rowRefs = useRef<Map<string, SwipeableMethods>>(new Map());
  const peekDone = useRef(false);
  const handleSwipeOpen = useCallback((openedId: string) => {
    rowRefs.current.forEach((ref, id) => {
      if (id !== openedId) ref.close();
    });
  }, []);

  useEffect(() => {
    (async () => {
      const seeded = await StorageService.isUserPromptsSeeded();
      if (!seeded) {
        // First time: seed with defaults
        const defaults = buildDefaultPrompts(t);
        await StorageService.setUserPrompts(defaults);
        await StorageService.markUserPromptsSeeded();
        setPrompts(defaults);
      } else {
        const saved = await StorageService.getUserPrompts();
        setPrompts(saved);
      }
      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-peek: briefly open the first row to reveal swipe actions (once per device)
  useEffect(() => {
    if (!loaded || prompts.length === 0 || peekDone.current) return;
    peekDone.current = true;
    let cancelled = false;
    (async () => {
      const shown = await StorageService.isPromptPeekShown();
      if (shown || cancelled) return;
      await StorageService.markPromptPeekShown();
      const firstId = prompts[0].id;
      setTimeout(() => {
        if (cancelled) return;
        const ref = rowRefs.current.get(firstId);
        if (!ref) return;
        ref.openRight();
        setTimeout(() => ref.close(), 600);
      }, 400);
    })();
    return () => { cancelled = true; };
  }, [loaded, prompts]);

  const handleSelect = useCallback((prompt: SavedPrompt) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectPrompt(prompt.text);
    onClose();
  }, [onSelectPrompt, onClose]);

  const handleAdd = useCallback(() => {
    setEditingPrompt(null);
    setEditorText('');
    setEditorVisible(true);
  }, []);

  const handleEdit = useCallback((prompt: SavedPrompt) => {
    setEditingPrompt(prompt);
    setEditorText(prompt.text);
    setEditorVisible(true);
  }, []);

  const handleDelete = useCallback((prompt: SavedPrompt) => {
    setDeleteCandidate(prompt);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteCandidate) return;
    const next = prompts.filter((prompt) => prompt.id !== deleteCandidate.id);
    setDeleteCandidate(null);
    setPrompts(next);
    void StorageService.setUserPrompts(next);
  }, [deleteCandidate, prompts]);

  const handleTogglePin = useCallback(async (prompt: SavedPrompt) => {
    const next = prompt.pinnedAt
      ? unpinPrompt(prompts, prompt.id)
      : pinPrompt(prompts, prompt.id);
    setPrompts(next);
    await StorageService.setUserPrompts(next);
  }, [prompts]);

  const handleSave = useCallback(async () => {
    const trimmed = editorText.trim();
    if (!trimmed) return;

    if (editingPrompt) {
      const next = prompts.map((p) =>
        p.id === editingPrompt.id
          ? { ...p, text: trimmed, updatedAt: Date.now() }
          : p,
      );
      setPrompts(next);
      await StorageService.setUserPrompts(next);
    } else {
      const newPrompt: SavedPrompt = {
        id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const next = [...prompts, newPrompt];
      setPrompts(next);
      await StorageService.setUserPrompts(next);
    }
    setEditorVisible(false);
    setEditingPrompt(null);
    setEditorText('');
  }, [editorText, editingPrompt, prompts]);

  const handleCancelEditor = useCallback(() => {
    setEditorVisible(false);
    setEditingPrompt(null);
    setEditorText('');
  }, []);

  if (editorVisible) {
    // Use half the keyboard height as bottom padding so the card shifts up enough
    // to keep the input and action buttons visible above the keyboard.
    const editorBottomPadding = keyboardHeight > 0 ? keyboardHeight / 2 : 0;
    return (
      <View style={[styles.editorContainer, { paddingBottom: Space.lg + editorBottomPadding }]}>
        <View style={styles.editorHeader}>
          <Text style={styles.editorTitle}>
            {editingPrompt ? t('Edit Prompt') : t('Add Prompt')}
          </Text>
        </View>
        <FormTextInput
          value={editorText}
          onChangeText={setEditorText}
          placeholder={t('Enter prompt text...')}
          multiline
          minHeight={140}
          autoFocus
          containerStyle={styles.editorInput}
          inputStyle={styles.editorInputText}
        />
        <View style={styles.editorActions}>
          <Button
            label={t('Cancel')}
            variant="secondary"
            size="sm"
            onPress={handleCancelEditor}
          />
          <Button
            label={t('Save')}
            size="sm"
            onPress={handleSave}
            disabled={!editorText.trim()}
          />
        </View>
      </View>
    );
  }

  if (!loaded) return <View style={styles.content} />;

  return (
    <>
      <View style={styles.content}>
      {prompts.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t('No custom prompts yet')}</Text>
          <Text style={styles.emptySubtitle}>{t('Tap + to add your first prompt')}</Text>
        </View>
      ) : (
        <FlatList
          data={prompts}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <View>
              {index > 0 && <View style={styles.divider} />}
              <SwipeableGatewayRow
                colors={colors}
                onEdit={() => handleEdit(item)}
                onDelete={() => handleDelete(item)}
                extraActions={[{
                  key: item.pinnedAt ? 'unpin' : 'pin',
                  backgroundColor: colors.inkSecondary,
                  icon: Pin,
                  iconColor: colors.surface,
                  onPress: () => { void handleTogglePin(item); },
                }]}
                onRegisterRef={(ref) => {
                  if (ref) rowRefs.current.set(item.id, ref);
                  else rowRefs.current.delete(item.id);
                }}
                onSwipeOpen={() => handleSwipeOpen(item.id)}
              >
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.rowContent}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {item.text}
                    </Text>
                    {item.pinnedAt ? (
                      <Pin size={14} color={colors.inkSecondary} strokeWidth={2} />
                    ) : null}
                    <ChevronLeft size={14} color={colors.inkTertiary} strokeWidth={1.5} />
                  </View>
                </Pressable>
              </SwipeableGatewayRow>
            </View>
          )}
          style={styles.list}
        />
      )}
      <View style={styles.addButtonWrap}>
        <Pressable
          style={({ pressed }) => [styles.addButton, { backgroundColor: colors.accent }, pressed && { opacity: 0.88 }]}
          onPress={handleAdd}
        >
          <Plus size={15} color={colors.onAccent} strokeWidth={2} />
          <Text style={[styles.addButtonText, { color: colors.onAccent }]}>{t('Add Prompt')}</Text>
        </Pressable>
      </View>
      </View>
      <ConfirmationModal
        visible={deleteCandidate != null}
        title={t('Delete')}
        message={deleteCandidate?.text ?? ''}
        cancelLabel={t('Cancel')}
        confirmLabel={t('Delete')}
        onClose={() => setDeleteCandidate(null)}
        onConfirm={confirmDelete}
        destructive
        testID="prompt-delete-confirmation"
      />
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      paddingBottom: Space.md,
    },
    row: {
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      backgroundColor: colors.surface,
    },
    rowContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    rowText: {
      flex: 1,
      fontSize: FontSize.secondary,
      color: colors.ink,
      lineHeight: 20,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
      marginLeft: Space.lg,
    },
    list: {
      maxHeight: 380,
    },
    emptyWrap: {
      alignItems: 'center',
      paddingVertical: Space.xl,
      paddingHorizontal: Space.lg,
    },
    emptyTitle: {
      fontSize: FontSize.caption,
      color: colors.inkSecondary,
      fontWeight: FontWeight.semibold,
    },
    emptySubtitle: {
      fontSize: FontSize.caption,
      color: colors.inkTertiary,
      marginTop: Space.xs,
    },
    addButtonWrap: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      paddingVertical: 11,
      borderRadius: Radius.full,
    },
    addButtonText: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
    // Editor
    editorContainer: {
      paddingHorizontal: Space.lg,
    },
    editorHeader: {
      paddingVertical: Space.sm,
    },
    editorTitle: {
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      color: colors.ink,
    },
    editorInput: {
      marginTop: Space.sm,
    },
    editorInputText: {
      maxHeight: 220,
      lineHeight: 22,
    },
    editorActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: Space.sm,
      marginTop: Space.md,
    },
  });
}
