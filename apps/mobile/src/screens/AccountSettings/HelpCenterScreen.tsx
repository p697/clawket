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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "replace-me"
    }
  }
}`;
const TAILNET_DIRECT_CONFIG = `{
  "gateway": {
    "bind": "tailnet",
    "auth": {
      "mode": "token",
      "token": "replace-me"
    }
  }
}`;
const TAILSCALE_SERVE_CONFIG = `{
  "gateway": {
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
    <SettingsGroup>
      {topics.map((topic, index) => {
        const Icon = topic.icon;
        return (
          <Fragment key={topic.id}>
            {index > 0 ? <SettingsDivider inset="content" /> : null}
            <SettingsRow
              testID={`help-topic-row-${topic.id}`}
              title={topic.title}
              leading={(
                <Icon
                  size={IconSize.sm}
                  color={theme.colors.inkSecondary}
                  strokeWidth={2}
                />
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
      onClose={onClose}
    >
      {topic ? (
        <ScrollView
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
        </ScrollView>
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

  const connectTopics = useMemo<ReadonlyArray<HelpTopic>>(() => [
    {
      id: 'pair',
      title: t('How to Connect'),
      icon: Terminal,
      paragraphs: [t('Follow these steps to connect Clawket to your OpenClaw.')],
      commands: [
        { label: t('Remote connection command', { ns: 'chat' }), value: 'npx @p697/clawket pair' },
        { label: t('Same Wi-Fi pairing', { ns: 'chat' }), value: 'npx @p697/clawket pair local' },
      ],
    },
    {
      id: 'lan',
      title: t('LAN direct'),
      icon: Router,
      paragraphs: [t('Use this when your phone is on the same local network as the OpenClaw host.')],
      commands: [
        { label: t('Minimal openclaw.json example'), value: LAN_DIRECT_CONFIG },
        { label: t('App URL'), value: 'ws://<lan-ip>:18789' },
      ],
    },
    {
      id: 'tailnet',
      title: t('Tailscale direct (no Serve)'),
      icon: Network,
      paragraphs: [
        t('Use this when both devices are in the same tailnet and you are not using tailscale serve.'),
        t('Direct Tailnet bind does not use Serve or Funnel.'),
      ],
      commands: [
        { label: t('Minimal openclaw.json example'), value: TAILNET_DIRECT_CONFIG },
        { label: t('App URL'), value: 'ws://<tailscale-ip>:18789' },
      ],
    },
    {
      id: 'tailscale-serve',
      title: t('Tailscale Serve'),
      icon: Radio,
      paragraphs: [
        t('Use this when you want Tailscale to publish HTTPS for the Gateway while OpenClaw stays on loopback.'),
        t('Tailscale Serve requires gateway.bind to stay on loopback.'),
      ],
      commands: [
        { label: t('Minimal openclaw.json example'), value: TAILSCALE_SERVE_CONFIG },
        { label: t('App URL'), value: 'wss://<magicdns-host>' },
      ],
    },
    {
      id: 'control-ui',
      title: t('Control UI / WebChat note'),
      icon: Globe2,
      paragraphs: [
        t('gateway.controlUi.allowedOrigins is only for browser-based Control UI or WebChat on non-loopback addresses. Clawket app connection itself does not depend on this field.'),
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
  ], [t]);

  const troubleshootingTopics = useMemo<ReadonlyArray<HelpTopic>>(() => [
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
        t('If using the default connection method, make sure your network connection is stable.'),
        t('If using LAN connection, make sure your phone and your OpenClaw machine are on the same local network.'),
      ],
    },
    {
      id: 'firewall',
      title: t('Check firewall and port'),
      icon: ShieldCheck,
      paragraphs: [t('The default WebSocket port is 18789. Make sure it is not blocked by a firewall or occupied by another process.')],
    },
    {
      id: 'credentials',
      title: t('Verify auth credentials'),
      icon: ShieldCheck,
      paragraphs: [t('Open openclaw.json on the host and confirm the auth token or password matches what you entered in the app.')],
    },
    {
      id: 'drops',
      title: t('Connection drops after a while'),
      icon: Wrench,
      paragraphs: [t('This is usually caused by network changes (Wi-Fi switching, sleep mode). The app will automatically reconnect. If it persists, try restarting the Gateway from Settings.')],
    },
    {
      id: 'auth-error',
      title: t('Auth error when connecting'),
      icon: Wrench,
      paragraphs: [t('Double-check the auth token or password in your connection settings. If you recently regenerated credentials, update them in the app.')],
    },
    {
      id: 'version',
      title: t('Gateway version mismatch'),
      icon: Wrench,
      paragraphs: [t('Update OpenClaw on your host with: npm update -g @nicepkg/openclaw. Then restart the Gateway.')],
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
          <SettingsGroup>
            {officialLinks.map((link, index) => {
              const Icon = link.icon;
              return (
                <Fragment key={link.id}>
                  {index > 0 ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`help-official-${link.id}`}
                    title={link.title}
                    leading={(
                      <Icon
                        size={IconSize.sm}
                        color={theme.colors.inkSecondary}
                        strokeWidth={2}
                      />
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
    gap: Space.lg,
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
