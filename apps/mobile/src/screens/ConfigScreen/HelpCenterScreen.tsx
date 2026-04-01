import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import {
  Gamepad2,
  HelpCircle,
  Info,
  Link2,
  Mail,
  MessageCircleMore,
} from "lucide-react-native";
import { CopyableCommand } from "../../components/config/CopyableCommand";
import { QuickConnectGuideCard } from "../../components/config/QuickConnectGuideCard";
import {
  ConnectionHelpStepList,
  ConnectionHelpStep,
} from "../../components/config/ConnectionHelpStepList";
import { ModalSheet } from "../../components/ui";
import { useNativeStackModalHeader } from "../../hooks/useNativeStackModalHeader";
import { useAppTheme } from "../../theme";
import { FontSize, FontWeight, Radius, Space } from "../../theme/tokens";
import { shouldShowWecomSupportEntry } from "../../utils/mainlandChina";
import { buildSupportEmailUrl, publicAppLinks } from "../../config/public";
import { saveBundledImageToPhotoLibrary } from "../../services/photo-library";
import { getHelpCenterCommunityEntries } from "./helpCenterCommunity";
import type { ConfigStackParamList } from "./ConfigTab";

type Navigation = NativeStackNavigationProp<ConfigStackParamList, "HelpCenter">;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WECHAT_QR_IMAGE = require("../../../assets/wechat-group-qr.jpg");
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

export function HelpCenterScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation("config");
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [wecomModalVisible, setWecomModalVisible] = useState(false);
  const showWecomEntry = shouldShowWecomSupportEntry();
  const supportEmailUrl = buildSupportEmailUrl(publicAppLinks.supportEmail);
  const communityEntries = getHelpCenterCommunityEntries(showWecomEntry).filter((entry) => (
    entry !== "discord" || Boolean(publicAppLinks.discordInviteUrl)
  ));

  useNativeStackModalHeader({
    navigation,
    title: t("Help Center"),
    onClose: () => navigation.goBack(),
  });

  const handleDownloadWecomQr = useCallback(async () => {
    try {
      const result = await saveBundledImageToPhotoLibrary(
        WECHAT_QR_IMAGE,
        "wechat-group-qr",
      );
      if (result === "permission_denied") {
        Alert.alert(
          t("Unable to save QR code"),
          t("Please allow photo library access and try again."),
        );
        return;
      }
      Alert.alert(t("Saved"), t("QR code saved to your photo library."));
    } catch (error) {
      console.warn("[WeComQr] Failed to save QR code:", error);
      Alert.alert(t("Unable to save QR code"), t("Please try again later."));
    }
  }, [t]);

  const troubleshootSteps = useMemo<ConnectionHelpStep[]>(
    () => [
      {
        title: t("Check that OpenClaw is running"),
        body: (
          <>
            <Text style={styles.stepBody}>
              {t(
                "Make sure the OpenClaw process is running on your host machine. Try running these commands to verify:",
              )}
            </Text>
            <CopyableCommand command="openclaw status" />
            <CopyableCommand command="openclaw doctor" />
          </>
        ),
      },
      {
        title: t("Verify network connectivity"),
        body: (
          <>
            <Text style={styles.stepBody}>
              {t(
                "If using the default connection method, make sure your network connection is stable.",
              )}
            </Text>
            <Text style={[styles.stepBody, styles.stepBodySpaced]}>
              {t(
                "If using LAN connection, make sure your phone and your OpenClaw machine are on the same local network.",
              )}
            </Text>
          </>
        ),
      },
      {
        title: t("Check firewall and port"),
        body: (
          <Text style={styles.stepBody}>
            {t(
              "The default WebSocket port is 18789. Make sure it is not blocked by a firewall or occupied by another process.",
            )}
          </Text>
        ),
      },
      {
        title: t("Verify auth credentials"),
        body: (
          <Text style={styles.stepBody}>
            {t(
              "Open openclaw.json on the host and confirm the auth token or password matches what you entered in the app.",
            )}
          </Text>
        ),
      },
    ],
    [styles, t],
  );

  const faqItems = useMemo(
    () => [
      {
        q: t("Connection drops after a while"),
        a: t(
          "This is usually caused by network changes (Wi-Fi switching, sleep mode). The app will automatically reconnect. If it persists, try restarting the Gateway from Settings.",
        ),
      },
      {
        q: t("Auth error when connecting"),
        a: t(
          "Double-check the auth token or password in your connection settings. If you recently regenerated credentials, update them in the app.",
        ),
      },
      {
        q: t("Gateway version mismatch"),
        a: t(
          "Update OpenClaw on your host with: pnpm add -g @nicepkg/openclaw@latest. Then restart the Gateway.",
        ),
      },
    ],
    [t],
  );
  const builtInConnectionConfigs = useMemo(
    () => [
      {
        title: t("LAN direct"),
        description: t(
          "Use this when your phone is on the same local network as the OpenClaw host.",
        ),
        config: LAN_DIRECT_CONFIG,
        url: "ws://<lan-ip>:18789",
        note: null,
      },
      {
        title: t("Tailscale direct (no Serve)"),
        description: t(
          "Use this when both devices are in the same tailnet and you are not using tailscale serve.",
        ),
        config: TAILNET_DIRECT_CONFIG,
        url: "ws://<tailscale-ip>:18789",
        note: t("Direct Tailnet bind does not use Serve or Funnel."),
      },
      {
        title: t("Tailscale Serve"),
        description: t(
          "Use this when you want Tailscale to publish HTTPS for the Gateway while OpenClaw stays on loopback.",
        ),
        config: TAILSCALE_SERVE_CONFIG,
        url: "wss://<magicdns-host>",
        note: t("Tailscale Serve requires gateway.bind to stay on loopback."),
      },
    ],
    [t],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Section: How to Connect */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Link2 size={16} color={theme.colors.primary} strokeWidth={2} />
          <Text style={styles.sectionTitle}>{t("How to Connect")}</Text>
        </View>
        <Text style={styles.sectionDesc}>
          {t("Follow these steps to connect Clawket to your OpenClaw.")}
        </Text>
        <QuickConnectGuideCard style={styles.guideCard} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Info size={16} color={theme.colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionTitle}>{t("Built-in connection configs")}</Text>
        </View>
        <Text style={styles.sectionDesc}>
          {t(
            "These examples are based on OpenClaw Gateway docs and config validation. Use the mode that matches how your phone reaches the Gateway.",
          )}
        </Text>
        {builtInConnectionConfigs.map((item, idx) => (
          <View
            key={item.title}
            style={[
              styles.configGuideCard,
              idx > 0 && styles.configGuideCardSpaced,
            ]}
          >
            <Text style={styles.configGuideTitle}>{item.title}</Text>
            <Text style={styles.configGuideText}>{item.description}</Text>
            <Text style={styles.configGuideLabel}>
              {t("Minimal openclaw.json example")}
            </Text>
            <CopyableCommand command={item.config} multiline />
            <Text style={styles.configGuideLabel}>{t("App URL")}</Text>
            <CopyableCommand command={item.url} />
            {item.note ? (
              <Text
                style={[styles.configGuideText, styles.configGuideTextSpaced]}
              >
                {item.note}
              </Text>
            ) : null}
          </View>
        ))}
        <View style={[styles.infoCard, styles.configGuideCardSpaced]}>
          <Text style={styles.configGuideTitle}>
            {t("Control UI / WebChat note")}
          </Text>
          <Text style={styles.configGuideText}>
            {t(
              "gateway.controlUi.allowedOrigins is only for browser-based Control UI or WebChat on non-loopback addresses. Clawket app connection itself does not depend on this field.",
            )}
          </Text>
          <Text style={[styles.configGuideText, styles.configGuideTextSpaced]}>
            {t(
              "If you open Control UI over LAN or direct Tailnet bind, add the exact browser origin you open in Safari or Chrome.",
            )}
          </Text>
          <Text style={styles.configGuideLabel}>
            {t("LAN / Tailnet browser origin example")}
          </Text>
          <CopyableCommand command="http://192.168.1.23:18789" />
          <Text style={[styles.configGuideText, styles.configGuideTextSpaced]}>
            {t(
              "If you open Control UI through Tailscale Serve, the browser origin is your HTTPS MagicDNS host.",
            )}
          </Text>
          <Text style={styles.configGuideLabel}>
            {t("Tailscale Serve browser origin example")}
          </Text>
          <CopyableCommand command="https://your-device.your-tailnet.ts.net" />
          <Text style={[styles.configGuideText, styles.configGuideTextSpaced]}>
            {t(
              "For Tailscale Serve, keep using your Gateway token or password in Clawket. Tailscale identity header auth applies to browser Control UI or WebChat, not app login.",
            )}
          </Text>
          <Text style={styles.configGuideLabel}>{t("Restart Gateway")}</Text>
          <CopyableCommand command="openclaw gateway restart" />
          <Text style={[styles.configGuideText, styles.configGuideTextSpaced]}>
            {t("After changing openclaw.json, restart the Gateway.")}
          </Text>
        </View>
      </View>

      {/* Section: Troubleshooting */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <HelpCircle size={16} color={theme.colors.primary} strokeWidth={2} />
          <Text style={styles.sectionTitle}>{t("Troubleshooting")}</Text>
        </View>
        <Text style={styles.sectionDesc}>
          {t("If the quick connect guide above did not help, try these steps.")}
        </Text>
        <View style={styles.stepsCard}>
          <ConnectionHelpStepList steps={troubleshootSteps} />
        </View>
      </View>

      {/* Section: FAQ */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Info size={16} color={theme.colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionTitle}>{t("Common Issues")}</Text>
        </View>
        {faqItems.map((item, idx) => (
          <View key={idx} style={styles.faqCard}>
            <Text style={styles.faqQuestion}>{item.q}</Text>
            <Text style={styles.faqAnswer}>{item.a}</Text>
          </View>
        ))}
      </View>

      {/* Section: What is OpenClaw */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Info size={16} color={theme.colors.textMuted} strokeWidth={2} />
          <Text style={styles.sectionTitle}>{t("What is OpenClaw?")}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            {t(
              "OpenClaw is an open-source AI gateway that runs on your machine. Clawket is its mobile companion — it connects to your OpenClaw instance so you can chat with AI agents, manage cron jobs, browse files, and monitor usage from your phone.",
            )}
          </Text>
        </View>
      </View>

      {/* Section: Contact */}
      <View style={styles.section}>
        {communityEntries.map((entry) => {
          if (entry === "discord") {
            return (
              <Pressable
                key={entry}
                onPress={() => Linking.openURL(publicAppLinks.discordInviteUrl as string)}
                style={({ pressed }) => [
                  styles.contactCard,
                  pressed && styles.contactCardPressed,
                ]}
              >
                <Gamepad2 size={16} strokeWidth={2} color={theme.colors.primary} />
                <View style={styles.contactText}>
                  <Text style={styles.contactTitle}>
                    {t("Join Discord Community")}
                  </Text>
                  <Text style={styles.contactMeta}>
                    {t("Get support, updates, and chat with other users.")}
                  </Text>
                </View>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={entry}
              onPress={() => setWecomModalVisible(true)}
              style={({ pressed }) => [
                styles.contactCard,
                styles.contactCardSpaced,
                pressed && styles.contactCardPressed,
              ]}
            >
              <MessageCircleMore
                size={16}
                strokeWidth={2}
                color={theme.colors.primary}
              />
              <View style={styles.contactText}>
                <Text style={styles.contactTitle}>{t("Join WeCom Group")}</Text>
                <Text style={styles.contactMeta}>
                  {t(
                    "Chinese-only feedback channel for issue reports and feature requests.",
                  )}
                </Text>
              </View>
            </Pressable>
          );
        })}

        {supportEmailUrl ? (
          <Pressable
            onPress={() => Linking.openURL(supportEmailUrl)}
            style={({ pressed }) => [
              styles.contactCard,
              styles.contactCardSpaced,
              pressed && styles.contactCardPressed,
            ]}
          >
            <Mail size={16} strokeWidth={2} color={theme.colors.primary} />
            <View style={styles.contactText}>
              <Text style={styles.contactTitle}>{t("Still need help?")}</Text>
              <Text style={styles.contactMeta}>{publicAppLinks.supportEmail}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      <ModalSheet
        visible={wecomModalVisible}
        onClose={() => setWecomModalVisible(false)}
        title={t("WeCom Group QR Code")}
      >
        <View style={styles.wecomModalBody}>
          <Image
            source={WECHAT_QR_IMAGE}
            style={styles.wecomQrImage}
            resizeMode="contain"
          />
          <Text style={styles.wecomModalHint}>
            {t("Scan this QR code in WeCom to join the group chat.")}
          </Text>
          <Pressable
            onPress={() => {
              void handleDownloadWecomQr();
            }}
            style={({ pressed }) => [
              styles.wecomDownloadButton,
              pressed && styles.wecomDownloadButtonPressed,
            ]}
          >
            <Text style={styles.wecomDownloadButtonText}>
              {t("Download QR Code")}
            </Text>
          </Pressable>
        </View>
      </ModalSheet>
    </ScrollView>
  );
}

function createStyles(
  colors: ReturnType<
    typeof import("../../theme").useAppTheme
  >["theme"]["colors"],
) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.xxl,
      paddingBottom: Space.xxxl,
    },
    section: {
      marginBottom: Space.xxl,
    },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Space.sm,
      marginBottom: Space.md,
    },
    sectionTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    sectionDesc: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 19,
      marginBottom: Space.md,
    },
    guideCard: {
      borderRadius: Radius.md,
    },
    configGuideCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
    },
    configGuideCardSpaced: {
      marginTop: Space.md,
    },
    configGuideTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    configGuideText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 19,
      marginTop: Space.xs,
    },
    configGuideTextSpaced: {
      marginTop: Space.sm,
    },
    configGuideLabel: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      marginTop: Space.md,
      marginBottom: Space.xs,
    },
    stepsCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
    },
    stepBody: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 18,
    },
    stepBodySpaced: {
      marginTop: Space.sm,
    },
    faqCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
      marginBottom: Space.sm,
    },
    faqQuestion: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      marginBottom: Space.xs,
    },
    faqAnswer: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 19,
    },
    infoCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
    },
    infoText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
    },
    contactCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: Space.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
    },
    contactCardPressed: {
      opacity: 0.7,
    },
    contactCardSpaced: {
      marginTop: Space.sm,
    },
    contactText: {
      flex: 1,
    },
    contactTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    contactMeta: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      marginTop: 2,
    },
    wecomModalBody: {
      alignItems: "center",
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.lg,
      gap: Space.md,
    },
    wecomQrImage: {
      width: 220,
      height: 220,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    wecomModalHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 19,
    },
    wecomDownloadButton: {
      width: "100%",
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      paddingVertical: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    wecomDownloadButtonPressed: {
      opacity: 0.88,
    },
    wecomDownloadButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
