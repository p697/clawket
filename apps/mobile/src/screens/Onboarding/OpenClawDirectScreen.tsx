import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { FlowHeader, PageIntro, FormStep, CommandBlock } from '../../components/ui/SetupPrimitives';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { useKeyboardRevealScroll } from '../../components/ui/useKeyboardRevealScroll';
import { useAppTheme } from '../../theme';
import { FontSize, LineHeight, Space } from '../../theme/tokens';
import { isIPad } from '../../utils/platform';
import type { OpenClawDirectDraft } from '../../connection/pairing/openclaw-direct';

export type OpenClawDirectScreenProps = Readonly<{
  busy: boolean;
  error?: 'url' | 'credential' | 'unauthorized' | 'pairing_required' | 'network' | 'server';
  onBack: () => void;
  onSubmit: (draft: OpenClawDirectDraft) => void;
  onCopyCommand: (command: string) => void;
}>;

export function OpenClawDirectScreen({ busy, error, onBack, onSubmit, onCopyCommand }: OpenClawDirectScreenProps) {
  const { t } = useTranslation('config');
  const { theme: { colors } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reveal = useKeyboardRevealScroll({ clearance: Space.lg, enabled: !isIPad });
  const [mode, setMode] = useState<OpenClawDirectDraft['mode']>('local');
  const [url, setUrl] = useState('');
  const [authMethod, setAuthMethod] = useState<OpenClawDirectDraft['authMethod']>('token');
  const [credential, setCredential] = useState('');
  const [help, setHelp] = useState(false);
  const messages = {
    url: t('Enter a valid Gateway address without credentials, query parameters or fragments.'),
    credential: t('Enter your Gateway token or password.'),
    unauthorized: t('Authentication failed. Check your Gateway token or password.'),
    pairing_required: t('Approve this device in OpenClaw on your computer, then connect again.'),
    network: t('Could not reach your Gateway. Check the address, network and Gateway listening settings, then try again.'),
    server: t('The Gateway could not complete the connection. Check OpenClaw on your computer, then try again.'),
  };
  return <View style={[styles.screen, { backgroundColor: colors.canvas, paddingTop: insets.top }]}>
    <FlowHeader onBack={onBack} testID="direct-back" title={t('Advanced connection')} />
    <KeyboardAvoidingView style={styles.screen} enabled={!isIPad} behavior="padding">
      <Reanimated.ScrollView ref={reveal.scrollRef} testID="direct-scroll" automaticallyAdjustKeyboardInsets={isIPad}
        keyboardShouldPersistTaps="handled" keyboardDismissMode={isIPad ? 'on-drag' : 'interactive'}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}>
        <PageIntro title={t('Connect OpenClaw directly')} description={t('Use your own Gateway address and credentials.')} />
        {error ? <Banner testID="direct-error" tone="bad" message={messages[error]} /> : null}
        <FormStep number="01" title={t('Connection type')}>
          <SegmentedTabs testID="direct-mode" size="sm" active={mode} tabs={[
            { key: 'local', label: t('Local network') }, { key: 'tailscale', label: t('Tailscale') }, { key: 'custom', label: t('Custom') },
          ]} onSwitch={(value) => { if (!busy) setMode(value); }} />
          <Text style={[styles.hint, { color: colors.inkSecondary }]}>{mode === 'local'
            ? t('Connect your phone and computer to the same Wi-Fi network.') : mode === 'tailscale'
              ? t('Connect both devices to the same Tailscale network.')
              : t('Use a reachable ws:// or wss:// OpenClaw Gateway endpoint.')}</Text>
        </FormStep>
        <FormStep number="02" title={t('Gateway address')}>
          <FormTextInput testID="direct-url" accessibilityLabel={t('Gateway address')} value={url} onChangeText={setUrl}
            editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
            placeholder={mode === 'local' ? 'ws://192.168.1.10:18789' : mode === 'tailscale' ? 'ws://100.64.0.10:18789' : 'wss://gateway.example.com'}
            invalid={error === 'url'} onFocus={reveal.measureAnchor} />
        </FormStep>
        <FormStep number="03" title={t('Authentication')}>
          <SegmentedTabs testID="direct-auth" size="sm" active={authMethod} tabs={[
            { key: 'token', label: t('Token') }, { key: 'password', label: t('Password') },
          ]} onSwitch={(value) => { if (!busy) { setAuthMethod(value); setCredential(''); } }} />
          <FormTextInput testID="direct-credential" accessibilityLabel={authMethod === 'token' ? t('Gateway token') : t('Gateway password')}
            value={credential} onChangeText={setCredential} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false}
            placeholder={authMethod === 'token' ? t('Gateway token') : t('Gateway password')} invalid={error === 'credential'}
            onFocus={reveal.measureAnchor} onSubmitEditing={() => { if (!busy) onSubmit({ mode, url, authMethod, credential }); }} />
          <View ref={reveal.anchorRef} collapsable={false} onLayout={reveal.measureAnchor}>
            <Button testID="direct-connect" label={busy ? t('Connecting…') : t('Connect')} loading={busy} disabled={busy}
              onPress={() => onSubmit({ mode, url, authMethod, credential })} />
          </View>
        </FormStep>
        <Button testID="direct-help" label={help ? t('Hide setup help') : t('How to set up your Gateway')} variant="text" onPress={() => setHelp(!help)} />
        {help ? <View style={styles.help}>
          <Text style={[styles.hint, { color: colors.inkSecondary }]}>{t('Read your Gateway token on the OpenClaw computer. For password authentication, use gateway.auth.password. The Gateway must listen on an address your phone can reach.')}</Text>
          <CommandBlock stacked command="openclaw config get gateway.auth.token" onCopy={() => onCopyCommand('openclaw config get gateway.auth.token')} />
          <Text style={[styles.hint, { color: colors.inkSecondary }]}>{t('For Tailscale, use the computer’s Tailscale IP with the Gateway port, or its HTTPS Serve address. Gateway authentication is still required.')}</Text>
          <Text style={[styles.hint, { color: colors.inkSecondary }]}>{t('For wss://, use a certificate trusted by your phone. Self-signed certificates are not accepted.')}</Text>
        </View> : null}
      </Reanimated.ScrollView>
    </KeyboardAvoidingView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { paddingHorizontal: Space.lg, gap: Space.xl },
  hint: { fontSize: FontSize.body, lineHeight: LineHeight.body }, help: { gap: Space.md },
});
