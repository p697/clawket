import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/ui/Sheet';
import { SheetHeaderButton } from '../../components/ui/SheetHeaderButton';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { SettingsRow, SettingsDivider } from '../../components/ui/SettingsGroup';
import { DocumentVersions, documentDiff, type DocumentVersion } from '../../services/document-versions';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { formatCronDate } from './cron-schedule';

const SNAP_POINTS = ['62%', '92%'];
export function DocumentHistorySheet({ visible, scope, current, onClose, onRestore }: Readonly<{
  visible: boolean; scope: string; current: string; onClose: () => void; onRestore: (text: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { theme } = useAppTheme();
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selected, setSelected] = useState<DocumentVersion | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const pending = useRef<{ scope: string; content: string } | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { pending.current = null; setConfirmClear(false); }, [scope]);
  useEffect(() => {
    let active = true;
    if (!visible) return;
    pending.current = null;
    setSelected(null); setError(false); setLoaded(false);
    void DocumentVersions.list(scope).then((items) => { if (active) setVersions(items); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [scope, visible]);
  const diff = useMemo(() => selected ? documentDiff(current, selected.content) : [], [current, selected]);
  return <><Sheet visible={visible && !confirmClear} onClose={onClose} title={t('Version history')} testID="document-history"
    snapPoints={SNAP_POINTS} closeAccessibilityLabel={t('Close', { ns: 'common' })}
    headerRight={selected ? <SheetHeaderButton icon={ArrowLeft} accessibilityLabel={t('Back', { ns: 'common' })} onPress={() => setSelected(null)} /> : versions.length ? <SheetHeaderButton icon={Trash2}
      accessibilityLabel={t('Delete', { ns: 'common' })} onPress={() => setConfirmClear(true)} /> : undefined}
    onAfterClose={() => { const next = pending.current; pending.current = null; if (next?.scope === currentScope.current) onRestore(next.content); }}>
    <BottomSheetScrollView contentContainerStyle={styles.content}>
      {error ? <Banner message={t('Failed to load file')} /> : null}
      {selected ? <>
        <Text style={[styles.caption, { color: theme.colors.inkSecondary }]}>{formatCronDate(selected.savedAt, i18n.resolvedLanguage)}</Text>
        <View style={styles.diff}>{diff.map((line, index) => <Text key={index} selectable style={[styles.line, {
          color: line.kind === 'added' ? theme.colors.good : line.kind === 'removed' ? theme.colors.bad : theme.colors.inkSecondary,
        }]}>{`${line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}${line.text}`}</Text>)}</View>
        <Button label={t('Restore version')} disabled={selected.content === current}
          onPress={() => { pending.current = { scope, content: selected.content }; onClose(); }} />
      </> : versions.map((version, index) => <React.Fragment key={version.id}>
        {index ? <SettingsDivider /> : null}
        <SettingsRow title={formatCronDate(version.savedAt, i18n.resolvedLanguage)}
          subtitle={version.content.trim().slice(0, 120) || t('Empty file')} subtitleLines={1} showChevron onPress={() => setSelected(version)} />
      </React.Fragment>)}
      {loaded && !error && !versions.length ? <Text style={[styles.caption, { color: theme.colors.inkSecondary }]}>{t('No saved versions')}</Text> : null}
    </BottomSheetScrollView>
  </Sheet>
    <ConfirmationModal visible={confirmClear} title={t('Delete', { ns: 'common' })}
      message={t('This cannot be undone.', { ns: 'common' })} confirmLabel={t('Delete', { ns: 'common' })}
      cancelLabel={t('Cancel', { ns: 'common' })} destructive onClose={() => setConfirmClear(false)}
      onConfirm={() => { setConfirmClear(false); void DocumentVersions.clear(scope)
        .then(() => { if (currentScope.current === scope) setVersions([]); })
        .catch(() => { if (currentScope.current === scope) setError(true); }); }} />
  </>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.sm },
  caption: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, paddingVertical: Space.md },
  diff: { paddingVertical: Space.md },
  line: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
});
