import React, { Fragment, useCallback, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { LucideIcon } from 'lucide-react-native';
import {
  BookOpen,
  Check,
  Copy,
  Gamepad2,
  Globe2,
  Mail,
  MessageCircleMore,
  Network,
  Radio,
  Router,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsIcon } from '../../components/ui/SettingsIcon';
import { Button } from '../../components/ui/Button';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { buildSupportEmailUrl, publicAppLinks } from '../../config/public';
import { saveBundledImageToPhotoLibrary } from '../../services/photo-library';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { shouldShowWecomSupportEntry } from '../../utils/mainlandChina';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';

type HelpTab = 'connect' | 'troubleshooting' | 'official';
type WecomSaveState = 'idle' | 'saving' | 'saved' | 'permission' | 'error';

type HelpCommand = Readonly<{
  label?: string;
  value: string;
}>;

type HelpTopic = Readonly<{
  id: string;
  title: string;
  icon: LucideIcon;
  paragraphs: ReadonlyArray<string>;
  commands?: ReadonlyArray<HelpCommand>;
}>;

// Topic paragraphs plus config blocks outgrow a phone screen, so the sheet
// scrolls inside fixed detents through the Gorhom-integrated scroll view.
const TOPIC_SHEET_SNAP_POINTS: string[] = ['68%', '92%'];

type OfficialLink = Readonly<{
  id: string;
  title: string;
  icon: LucideIcon;
  onPress: () => void;
}>;

export type HelpCenterScreenProps = Readonly<{
  onBack: () => void;
  onOpenUrl?: (url: string) => Promise<void> | void;
  showWecomEntry?: boolean;
}>;

export type HelpCenterCommunityEntry = 'discord' | 'wecom';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WECOM_QR_IMAGE = require('../../../assets/wechat-group-qr.jpg');
const HERMES_DOCUMENTATION_URL =
  'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart';
const OPENCLAW_DOCUMENTATION_URL = 'https://docs.openclaw.ai';
const OPENCLAW_RELEASES_URL = 'https://github.com/openclaw/openclaw/releases';
const LAN_DIRECT_CONFIG = `{
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "tailscale": { "mode": "off" },
    "controlUi": { "allowedOrigins": ["http://<lan-ip>:18789"] },
    "auth": {
      "mode": "token",
      "token": "replace-me"
    }
  }
}`;
const TAILNET_DIRECT_CONFIG = `{
  "gateway": {
    "mode": "local",
    "bind": "tailnet",
    "tailscale": { "mode": "off" },
    "controlUi": { "allowedOrigins": ["http://<tailscale-ip>:18789"] },
    "auth": {
      "mode": "token",
      "token": "replace-me"
    }
  }
}`;
const TAILSCALE_SERVE_CONFIG = `{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "tailscale": {
      "mode": "serve"
    },
    "auth": {
      "mode": "token",
      "token": "replace-me"
    }
  }
}`;

export function getHelpCenterCommunityEntries(
  showWecomEntry: boolean,
): HelpCenterCommunityEntry[] {
  return showWecomEntry ? ['discord', 'wecom'] : ['discord'];
}

async function openUrlWithLinking(url: string): Promise<void> {
  await Linking.openURL(url);
}

function CommandBlock({
  command,
  topicId,
  index,
}: Readonly<{
  command: HelpCommand;
  topicId: string;
  index: number;
}>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(command.value);
    setCopied(true);
  }, [command.value]);

  return (
    <View style={styles.commandWrap}>
      {command.label ? (
        <Text style={[styles.commandLabel, { color: theme.colors.inkSecondary }]}>
          {command.label}
        </Text>
      ) : null}
      <Pressable
        testID={`help-command-${topicId}-${index}`}
        accessibilityRole="button"
        accessibilityLabel={t('common:Copy')}
        onPress={() => { void copy(); }}
        style={({ pressed }) => [
          styles.command,
          { backgroundColor: theme.colors.surfaceFloating },
          pressed ? styles.pressed : null,
        ]}
      >
        <Text
          selectable
          style={[styles.commandText, { color: theme.colors.ink }]}
        >
          {command.value}
        </Text>
        {copied ? (
          <Check size={IconSize.sm} color={theme.colors.good} strokeWidth={2} />
        ) : (
          <Copy size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );
}

function TopicRows({
  topics,
  onSelect,
}: Readonly<{
  topics: ReadonlyArray<HelpTopic>;
  onSelect: (topic: HelpTopic) => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <SettingsGroup density="comfortable">
      {topics.map((topic, index) => {
        const Icon = topic.icon;
        return (
          <Fragment key={topic.id}>
            {index > 0 ? <SettingsDivider inset="icon" /> : null}
            <SettingsRow
              testID={`help-topic-row-${topic.id}`}
              title={topic.title}
              leading={(
                <SettingsIcon icon={Icon} tone="neutral" size={20} strokeWidth={1.75} />
              )}
              showChevron
              onPress={() => onSelect(topic)}
            />
          </Fragment>
        );
      })}
    </SettingsGroup>
  );
}

function TopicSheet({
  topic,
  onClose,
}: Readonly<{
  topic: HelpTopic | null;
  onClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  return (
    <Sheet
      visible={Boolean(topic)}
      testID={topic ? `help-topic-sheet-${topic.id}` : 'help-topic-sheet'}
      title={topic?.title}
      closeAccessibilityLabel={t('common:Close')}
      snapPoints={TOPIC_SHEET_SNAP_POINTS}
      onClose={onClose}
    >
      {topic ? (
        <BottomSheetScrollView
          testID="help-topic-scroll"
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          {topic.paragraphs.map((paragraph, index) => (
            <Text
              key={`${topic.id}-paragraph-${index}`}
              style={[styles.detailText, { color: theme.colors.inkSecondary }]}
            >
              {paragraph}
            </Text>
          ))}
          {topic.commands?.map((command, index) => (
            <CommandBlock
              key={`${topic.id}-command-${index}`}
              command={command}
              topicId={topic.id}
              index={index}
            />
          ))}
        </BottomSheetScrollView>
      ) : null}
    </Sheet>
  );
}

export function HelpCenterScreen({
  onBack,
  onOpenUrl = openUrlWithLinking,
  showWecomEntry = shouldShowWecomSupportEntry(),
}: HelpCenterScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<HelpTab>('connect');
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [wecomVisible, setWecomVisible] = useState(false);
  const [wecomSaveState, setWecomSaveState] = useState<WecomSaveState>('idle');
  const [linkErrorVisible, setLinkErrorVisible] = useState(false);

  const tabs = useMemo(() => [
    { key: 'connect' as const, label: t('Connect') },
    { key: 'troubleshooting' as const, label: t('Troubleshooting') },
    { key: 'official' as const, label: t('common:Official') },
  ], [t]);

  const directSetup = t('OpenClaw only: merge these fields into the existing gateway configuration; do not replace the whole file. Replace address placeholders and use a strong private token instead of replace-me. Restart Gateway, then run the URL pairing command and scan its QR.');

  const connectTopics = useMemo<ReadonlyArray<HelpTopic>>(() => [
    {
      id: 'pair',
      title: t('How to Connect'),
      icon: Terminal,
      paragraphs: [
        t('Run these commands on the computer running OpenClaw or Hermes, with Node.js and npm installed. Pair uses Relay; pair local uses your local network.'),
        t('In Add connection, choose the backend and enter its pairing code, or scan or import its QR. Local pairing uses QR. If both backends are installed, the CLI prints a result for each. Keep the host running.'),
      ],
      commands: [
        { label: t('Remote connection command', { ns: 'chat' }), value: 'npx @p697/clawket pair' },
        { label: t('Same Wi-Fi pairing', { ns: 'chat' }), value: 'npx @p697/clawket pair local' },
      ],
    },
    {
      id: 'lan',
      title: t('LAN direct'),
      icon: Router,
      paragraphs: [t('Use this when your phone is on the same local network as the OpenClaw host.'), directSetup],
      commands: [
        { label: t('Minimal openclaw.json example'), value: LAN_DIRECT_CONFIG },
        { label: t('Restart Gateway'), value: 'openclaw gateway restart' },
        { value: 'npx @p697/clawket pair local --backend openclaw --url "ws://<lan-ip>:18789"' },
      ],
    },
    {
      id: 'tailnet',
      title: t('Tailscale direct (no Serve)'),
      icon: Network,
      paragraphs: [
        t('Use this when both devices are in the same tailnet and you are not using tailscale serve.'),
        t('Direct Tailnet bind does not use Serve or Funnel.'),
        directSetup,
      ],
      commands: [
        { label: t('Minimal openclaw.json example'), value: TAILNET_DIRECT_CONFIG },
        { label: t('Restart Gateway'), value: 'openclaw gateway restart' },
        { value: 'npx @p697/clawket pair local --backend openclaw --url "ws://<tailscale-ip>:18789"' },
      ],
    },
    {
      id: 'tailscale-serve',
      title: t('Tailscale Serve'),
      icon: Radio,
      paragraphs: [
        t('Use this when you want Tailscale to publish HTTPS for the Gateway while OpenClaw stays on loopback.'),
        t('Tailscale Serve requires gateway.bind to stay on loopback.'),
        t('For LAN, put the phone and host on the same network. For Tailscale, connect both devices to the same tailnet.'),
        directSetup,
      ],
      commands: [
        { label: t('Minimal openclaw.json example'), value: TAILSCALE_SERVE_CONFIG },
        { label: t('Restart Gateway'), value: 'openclaw gateway restart' },
        { value: 'npx @p697/clawket pair local --backend openclaw --url "wss://<magicdns-host>"' },
      ],
    },
    {
      id: 'control-ui',
      title: t('Control UI / WebChat note'),
      icon: Globe2,
      paragraphs: [
        t('Clawket does not use browser origin authentication, but some OpenClaw versions require allowedOrigins to start a non-loopback Gateway with Control UI enabled. Keep the exact browser origins in the examples.'),
        t('If you open Control UI over LAN or direct Tailnet bind, add the exact browser origin you open in Safari or Chrome.'),
        t('If you open Control UI through Tailscale Serve, the browser origin is your HTTPS MagicDNS host.'),
        t('For Tailscale Serve, keep using your Gateway token or password in Clawket. Tailscale identity header auth applies to browser Control UI or WebChat, not app login.'),
        t('After changing openclaw.json, restart the Gateway.'),
      ],
      commands: [
        { label: t('LAN / Tailnet browser origin example'), value: 'http://192.168.1.23:18789' },
        { label: t('Tailscale Serve browser origin example'), value: 'https://your-device.your-tailnet.ts.net' },
        { label: t('Restart Gateway'), value: 'openclaw gateway restart' },
      ],
    },
  ], [t, directSetup]);

  const troubleshootingTopics = useMemo<ReadonlyArray<HelpTopic>>(() => [
    {
      id: 'bridge',
      title: t('Check Clawket Bridge'),
      icon: Terminal,
      paragraphs: [t('For OpenClaw and Hermes, run these checks on the host. Status and doctor inspect Clawket services; logs follows their output until Ctrl+C. If a paired Bridge is stopped, use start. For local OpenClaw, also check Gateway below.')],
      commands: [
        { value: 'npx @p697/clawket status' },
        { value: 'npx @p697/clawket doctor' },
        { value: 'npx @p697/clawket logs --follow' },
        { value: 'npx @p697/clawket start' },
      ],
    },
    {
      id: 'running',
      title: t('Check that OpenClaw is running'),
      icon: Terminal,
      paragraphs: [t('Make sure the OpenClaw process is running on your host machine. Try running these commands to verify:')],
      commands: [
        { value: 'openclaw status' },
        { value: 'openclaw doctor' },
      ],
    },
    {
      id: 'network',
      title: t('Verify network connectivity'),
      icon: Network,
      paragraphs: [
        t('Relay needs internet access on both the phone and the host. Keep the host awake and the Clawket Bridge running.'),
        t('For LAN, put the phone and host on the same network. For Tailscale, connect both devices to the same tailnet.'),
      ],
    },
    {
      id: 'firewall',
      title: t('Check firewall and port'),
      icon: ShieldCheck,
      paragraphs: [t('Direct OpenClaw uses port 18789 by default; Hermes local pairing uses 4319. Use the port printed by the CLI. Relay does not require opening these ports to the internet.')],
    },
    {
      id: 'credentials',
      title: t('Verify auth credentials'),
      icon: ShieldCheck,
      paragraphs: [t('For OpenClaw, credentials may come from openclaw.json, environment variables or SecretRef. Do not copy a SecretRef as a token. After credentials change, run pairing again and use the new code or QR in Add connection. Hermes does not use openclaw.json.')],
    },
    {
      id: 'drops',
      title: t('Connection drops after a while'),
      icon: Wrench,
      commands: [{ value: 'npx @p697/clawket restart' }],
      paragraphs: [t('After a network change, the app reconnects automatically. In Account settings, open Connections, select the connection and tap Reconnect or Resume connection. If it still fails, check the host and Bridge; restart a managed Bridge with the command below.')],
    },
    {
      id: 'auth-error',
      title: t('Auth error when connecting'),
      icon: Wrench,
      paragraphs: [t('If a pairing code has expired or was already used, run pairing again on the host. Select the matching backend in the app and use the new code or QR. Official Preview codes only work with Preview enabled.')],
    },
    {
      id: 'version',
      title: t('Gateway version mismatch'),
      icon: Wrench,
      commands: [
        { value: 'openclaw update' },
        { value: 'openclaw gateway status' },
        { label: t('Restart Gateway'), value: 'openclaw gateway restart' },
      ],
      paragraphs: [t('For OpenClaw only: run the update command on the host and follow its instructions. Then check Gateway status. If you changed its configuration, restart the installed Gateway service.')],
    },
  ], [t]);

  const openOfficialUrl = useCallback(async (url: string) => {
    try {
      await onOpenUrl(url);
    } catch {
      setLinkErrorVisible(true);
    }
  }, [onOpenUrl]);

  const closeWecom = useCallback(() => {
    setWecomVisible(false);
    setWecomSaveState('idle');
  }, []);

  const saveWecomQr = useCallback(async () => {
    if (wecomSaveState === 'saving') return;
    setWecomSaveState('saving');
    try {
      const result = await saveBundledImageToPhotoLibrary(
        WECOM_QR_IMAGE,
        'wechat-group-qr',
      );
      setWecomSaveState(result === 'saved' ? 'saved' : 'permission');
    } catch {
      setWecomSaveState('error');
    }
  }, [wecomSaveState]);

  const officialLinks = useMemo<ReadonlyArray<OfficialLink>>(() => {
    const links: OfficialLink[] = [
      {
        id: 'openclaw-docs',
        title: t('OpenClaw Documentation'),
        icon: BookOpen,
        onPress: () => { void openOfficialUrl(publicAppLinks.docsUrl ?? OPENCLAW_DOCUMENTATION_URL); },
      },
      {
        id: 'hermes-docs',
        title: t('Hermes Documentation'),
        icon: BookOpen,
        onPress: () => { void openOfficialUrl(HERMES_DOCUMENTATION_URL); },
      },
      {
        id: 'openclaw-releases',
        title: t('OpenClaw Releases'),
        icon: Globe2,
        onPress: () => { void openOfficialUrl(publicAppLinks.openClawReleasesUrl ?? OPENCLAW_RELEASES_URL); },
      },
    ];
    const communityEntries = getHelpCenterCommunityEntries(showWecomEntry);
    if (communityEntries.includes('discord') && publicAppLinks.discordInviteUrl) {
      links.push({
        id: 'discord',
        title: t('Join Discord Community'),
        icon: Gamepad2,
        onPress: () => { void openOfficialUrl(publicAppLinks.discordInviteUrl as string); },
      });
    }
    if (communityEntries.includes('wecom')) {
      links.push({
        id: 'wecom',
        title: t('Join WeCom Group'),
        icon: MessageCircleMore,
        onPress: () => setWecomVisible(true),
      });
    }
    const supportEmailUrl = buildSupportEmailUrl(publicAppLinks.supportEmail);
    if (supportEmailUrl) {
      links.push({
        id: 'email',
        title: t('Still need help?'),
        icon: Mail,
        onPress: () => { void openOfficialUrl(supportEmailUrl); },
      });
    }
    return links;
  }, [openOfficialUrl, showWecomEntry, t]);

  const wecomStatus = wecomSaveState === 'saved'
    ? t('QR code saved to your photo library.')
    : wecomSaveState === 'permission'
      ? t('Please allow photo library access and try again.')
      : wecomSaveState === 'error'
        ? t('Please try again later.')
        : null;

  return (
    <View
      testID="help-center-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <AccountSettingsPageHeader
        testID="help-center"
        title={t('Help Center')}
        onBack={onBack}
      />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Space.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SegmentedTabs
          testID="help-center-tabs"
          tabs={tabs}
          active={activeTab}
          onSwitch={setActiveTab}
        />
        {activeTab === 'connect' ? (
          <TopicRows topics={connectTopics} onSelect={setTopic} />
        ) : activeTab === 'troubleshooting' ? (
          <TopicRows topics={troubleshootingTopics} onSelect={setTopic} />
        ) : (
          <SettingsGroup density="comfortable">
            {officialLinks.map((link, index) => {
              const Icon = link.icon;
              return (
                <Fragment key={link.id}>
                  {index > 0 ? <SettingsDivider inset="icon" /> : null}
                  <SettingsRow
                    testID={`help-official-${link.id}`}
                    title={link.title}
                    leading={(
                      <SettingsIcon icon={Icon} tone="neutral" size={20} strokeWidth={1.75} />
                    )}
                    showChevron
                    onPress={link.onPress}
                  />
                </Fragment>
              );
            })}
          </SettingsGroup>
        )}
      </ScrollView>

      <TopicSheet topic={topic} onClose={() => setTopic(null)} />
      <Sheet
        visible={wecomVisible}
        testID="help-wecom-sheet"
        title={t('WeCom Group QR Code')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeWecom}
      >
        <View style={styles.wecomContent}>
          <Image
            accessibilityLabel={t('WeCom Group QR Code')}
            source={WECOM_QR_IMAGE}
            resizeMode="contain"
            style={[
              styles.wecomImage,
              { backgroundColor: theme.colors.surfaceFloating },
            ]}
          />
          <Text style={[styles.detailText, { color: theme.colors.inkSecondary }]}>
            {t('Scan this QR code in WeCom to join the group chat.')}
          </Text>
          {wecomStatus ? (
            <Text
              testID="help-wecom-save-status"
              style={[
                styles.wecomStatus,
                {
                  color: wecomSaveState === 'saved'
                    ? theme.colors.good
                    : theme.colors.bad,
                },
              ]}
            >
              {wecomStatus}
            </Text>
          ) : null}
          <Button
            testID="help-wecom-save"
            label={wecomSaveState === 'saved' ? t('Saved') : t('Download QR Code')}
            loading={wecomSaveState === 'saving'}
            onPress={() => { void saveWecomQr(); }}
          />
        </View>
      </Sheet>
      <Sheet
        visible={linkErrorVisible}
        testID="help-link-error-sheet"
        title={t('common:Unable to open link')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={() => setLinkErrorVisible(false)}
      >
        <View style={styles.errorContent}>
          <Text style={[styles.detailText, { color: theme.colors.inkSecondary }]}>
            {t('Please try again later.')}
          </Text>
          <Button
            label={t('common:Done')}
            onPress={() => setLinkErrorVisible(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    gap: Space.xl,
  },
  sheetContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  detailText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  commandWrap: { gap: Space.xs },
  commandLabel: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  command: {
    minHeight: Space.xxl,
    borderRadius: Radius.card,
    padding: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  commandText: {
    flex: 1,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  pressed: { opacity: 0.72 },
  wecomContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    alignItems: 'stretch',
    gap: Space.md,
  },
  wecomImage: {
    width: 220,
    height: 220,
    alignSelf: 'center',
    borderRadius: Radius.card,
  },
  wecomStatus: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  errorContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
});
