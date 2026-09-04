import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Camera, ImageIcon, Link2, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { analyticsEvents } from '../../services/analytics/events';
import { YouMindClient } from '../../services/youmind';
import { useAppTheme } from '../../theme';
import { BorderWidth, FontSize, FontWeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { isMacCatalyst } from '../../utils/platform';
import { Button, FormTextInput, ModalSheet } from '../ui';

type ViewMode = 'menu' | 'photoPreview' | 'cameraPreview';

type PendingImage = {
  uri: string;
  mimeType?: string;
  fileName?: string;
  source: 'photo' | 'camera';
};

const MAX_LIBRARY_SELECTION = 20;

type Props = {
  visible: boolean;
  onClose: () => void;
  boardId?: string;
  client: YouMindClient;
  onCreated: () => void | Promise<void>;
};

type ActionCardProps = {
  icon: React.JSX.Element;
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
};

type ParsedLinkState = {
  urls: string[];
  invalidLines: string[];
};

function normalizeCandidateUrl(value: string): string {
  return value.trim().replace(/[),.;!?]+$/g, '');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

function parseUrlsFromText(text: string): ParsedLinkState {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const urls: string[] = [];
  const seen = new Set<string>();
  const invalidLines: string[] = [];

  for (const line of lines) {
    const matches = Array.from(line.matchAll(/https?:\/\/[^\s]+/gi))
      .map((match) => normalizeCandidateUrl(match[0] ?? ''))
      .filter(Boolean);

    if (matches.length === 0) {
      invalidLines.push(line);
      continue;
    }

    let lineHasValidUrl = false;
    for (const candidate of matches) {
      if (!isValidHttpUrl(candidate)) continue;
      lineHasValidUrl = true;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        urls.push(candidate);
      }
    }
    if (!lineHasValidUrl) {
      invalidLines.push(line);
    }
  }

  return { urls, invalidLines };
}

export function YouMindAddMaterialSheet({
  visible,
  onClose,
  boardId,
  client,
  onCreated,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const [viewMode, setViewMode] = useState<ViewMode>('menu');
  const [linkDraft, setLinkDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const boardReady = typeof boardId === 'string' && boardId.trim().length > 0;

  useEffect(() => {
    if (!visible) {
      setViewMode('menu');
      setLinkDraft('');
      setPendingImages([]);
      setSelectedImageIndex(0);
      setSubmitting(false);
      setPicking(false);
    }
  }, [visible]);

  useEffect(() => {
    if (pendingImages.length === 0) {
      setSelectedImageIndex(0);
      return;
    }
    setSelectedImageIndex((current) => Math.min(current, pendingImages.length - 1));
  }, [pendingImages]);

  const parsedLinks = useMemo(() => parseUrlsFromText(linkDraft), [linkDraft]);

  const handleError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : t('Something went wrong. Please try again.');
    Alert.alert(t('Unable to add material'), message);
  }, [t]);

  const finishSuccess = useCallback(async () => {
    await onCreated();
    onClose();
  }, [onClose, onCreated]);

  const goBackToMenu = useCallback(() => {
    setViewMode('menu');
    setPendingImages([]);
    setSelectedImageIndex(0);
  }, []);

  const clearLinks = useCallback(() => {
    setLinkDraft('');
  }, []);

  const pickImage = useCallback(async (source: 'photo' | 'camera') => {
    if (!boardReady) return;
    if (picking || submitting) return;
    setPicking(true);
    analyticsEvents.youMindMaterialAddTapped({
      action: source,
      source: 'workspace_header',
    });

    try {
      const result = source === 'photo' || isMacCatalyst
        ? await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: MAX_LIBRARY_SELECTION,
          quality: 0.92,
          exif: false,
        })
        : await (async () => {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            throw new Error(t('Camera access is required to take a photo.'));
          }
          return ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.92,
            exif: false,
          });
        })();

      if (!result.canceled && result.assets.length > 0) {
        setPendingImages(result.assets.map((asset) => ({
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg',
          fileName: asset.fileName ?? undefined,
          source,
        })));
        setSelectedImageIndex(0);
        setViewMode(source === 'photo' ? 'photoPreview' : 'cameraPreview');
      }
    } catch (error) {
      analyticsEvents.youMindMaterialAddResolved({
        action: source,
        result: 'failure',
        source: 'workspace_header',
      });
      handleError(error);
    } finally {
      setPicking(false);
    }
  }, [boardReady, handleError, picking, submitting, t]);

  const submitLinks = useCallback(async () => {
    if (!boardReady || !boardId) return;
    if (parsedLinks.urls.length === 0) {
      Alert.alert(t('Invalid link'), t('Paste at least one valid http:// or https:// link.'));
      return;
    }
    if (parsedLinks.invalidLines.length > 0) {
      Alert.alert(
        t('Some links need attention'),
        t('Remove invalid lines before submitting. We only accept valid http:// or https:// links.'),
      );
      return;
    }

    setSubmitting(true);
    try {
      analyticsEvents.youMindMaterialAddTapped({
        action: 'link',
        source: 'workspace_header',
      });
      for (const url of parsedLinks.urls) {
        await client.createMaterialByUrl(boardId, url);
      }
      analyticsEvents.youMindMaterialAddResolved({
        action: 'link',
        result: 'success',
        source: 'workspace_header',
      });
      setLinkDraft('');
      await finishSuccess();
    } catch (error) {
      analyticsEvents.youMindMaterialAddResolved({
        action: 'link',
        result: 'failure',
        source: 'workspace_header',
      });
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }, [boardId, boardReady, client, finishSuccess, handleError, parsedLinks, t]);

  const submitImage = useCallback(async () => {
    if (!boardReady || !boardId || pendingImages.length === 0) return;

    const firstPendingImage = pendingImages[0]!;
    const action = firstPendingImage.source;

    analyticsEvents.youMindMaterialAddResolved({
      action,
      result: 'started',
      source: 'workspace_header',
    });
    setSubmitting(true);
    try {
      for (const pendingImage of pendingImages) {
        await client.createImageMaterial({
          boardId,
          uri: pendingImage.uri,
          mimeType: pendingImage.mimeType,
          fileName: pendingImage.fileName,
        });
      }
      analyticsEvents.youMindMaterialAddResolved({
        action,
        result: 'success',
        source: 'workspace_header',
      });
      await finishSuccess();
    } catch (error) {
      analyticsEvents.youMindMaterialAddResolved({
        action,
        result: 'failure',
        source: 'workspace_header',
      });
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }, [boardId, boardReady, client, finishSuccess, handleError, pendingImages]);

  const headerTitle = viewMode === 'cameraPreview'
      ? t('Camera')
      : viewMode === 'photoPreview'
        ? t('Photo')
        : t('Add material');

  const renderInlineLinkSection = () => (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('Link')}</Text>
        {linkDraft.trim().length > 0 ? (
          <Button
            label={t('Clear')}
            icon={Trash2}
            variant="ghost"
            size="sm"
            disabled={submitting}
            onPress={clearLinks}
          />
        ) : null}
      </View>

      <FormTextInput
        value={linkDraft}
        onChangeText={setLinkDraft}
        placeholder={t('Paste one or more links here, each on a separate line')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        multiline
        minHeight={112}
        surface="sunken"
      />

      {parsedLinks.invalidLines.length > 0 ? (
        <View style={styles.invalidStatusRow}>
          <Text style={[styles.statusText, { color: theme.colors.error }]}>
            {t('{{count}} invalid lines', { count: parsedLinks.invalidLines.length })}
          </Text>
        </View>
      ) : null}

      <Button
        label={parsedLinks.urls.length > 1
          ? t('Add {{count}} links', { count: parsedLinks.urls.length })
          : t('Add link')}
        disabled={submitting || parsedLinks.urls.length === 0 || !boardReady}
        loading={submitting}
        onPress={() => {
          void submitLinks();
        }}
      />
    </View>
  );

  const renderMenu = () => (
    <View style={styles.menuStack}>
      {renderInlineLinkSection()}
      <View style={styles.mediaSection}>
        <Text style={[styles.mediaSectionTitle, { color: theme.colors.text }]}>{t('Image')}</Text>
        <View style={styles.cardGrid}>
          <ActionCard
            icon={<ImageIcon size={20} color={theme.colors.primary} strokeWidth={2.1} />}
            title={t('Upload Photos')}
            disabled={!boardReady}
            onPress={() => {
              void pickImage('photo');
            }}
          />
          <ActionCard
            icon={<Camera size={20} color={theme.colors.primary} strokeWidth={2.1} />}
            title={t('Camera')}
            disabled={!boardReady}
            onPress={() => {
              void pickImage('camera');
            }}
          />
        </View>
      </View>
    </View>
  );

  const renderImagePreview = () => {
    if (pendingImages.length === 0) return null;
    const selectedImage = pendingImages[selectedImageIndex] ?? pendingImages[0]!;
    const isCamera = selectedImage.source === 'camera';
    const isMultiplePhotos = !isCamera && pendingImages.length > 1;
    const canDelete = pendingImages.length > 0;

    const handleDeleteSelectedImage = () => {
      if (!canDelete) return;
      setPendingImages((current) => {
        if (current.length === 0) return current;
        const nextImages = current.filter((_, index) => index !== selectedImageIndex);
        if (nextImages.length === 0) {
          setViewMode('menu');
          setSelectedImageIndex(0);
          return [];
        }
        setSelectedImageIndex((currentIndex) => Math.min(currentIndex, nextImages.length - 1));
        return nextImages;
      });
    };

    return (
      <View style={styles.stack}>
        <View style={styles.inlineHeader}>
          <Button
            label={t('Back')}
            icon={ArrowLeft}
            variant="ghost"
            size="sm"
            disabled={submitting}
            onPress={goBackToMenu}
          />
        </View>

        <View style={styles.previewStack}>
          <View style={styles.previewHero}>
            <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Delete')}
              style={({ pressed }) => [
                styles.previewDeleteButton,
                {
                  opacity: pressed || submitting ? 0.72 : 1,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
              disabled={submitting}
              onPress={handleDeleteSelectedImage}
            >
              <Trash2 size={16} color={theme.colors.text} strokeWidth={2.2} />
            </Pressable>
          </View>
          {isMultiplePhotos ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.previewStrip}
            >
              {pendingImages.map((image, index) => (
                <Pressable
                  key={`${image.uri}-${index}`}
                  style={({ pressed }) => [
                    styles.previewThumbWrap,
                    {
                      opacity: pressed ? 0.82 : 1,
                      borderColor: index === selectedImageIndex ? theme.colors.primary : theme.colors.borderStrong,
                    },
                  ]}
                  onPress={() => {
                    setSelectedImageIndex(index);
                  }}
                >
                  <Image
                    source={{ uri: image.uri }}
                    style={styles.previewThumb}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>

        <Text style={[styles.helperText, { color: theme.colors.textSubtle }]}>
          {isCamera
            ? t('This new capture will be added to the current workspace as an image material.')
            : isMultiplePhotos
              ? t('These {{count}} photos will be added to the current workspace as image materials.', { count: pendingImages.length })
              : t('This photo will be added to the current workspace as an image material.')}
        </Text>

        <Button
          label={isCamera
            ? t('Add capture')
            : isMultiplePhotos
              ? t('Add {{count}} photos', { count: pendingImages.length })
              : t('Add photo')}
          disabled={submitting}
          loading={submitting}
          onPress={() => {
            void submitImage();
          }}
        />
      </View>
    );
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title={headerTitle} maxHeight="82%">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {viewMode === 'menu' ? renderMenu() : null}
          {viewMode === 'photoPreview' || viewMode === 'cameraPreview' ? renderImagePreview() : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ModalSheet>
  );
}

function ActionCard({ icon, title, subtitle, onPress, disabled = false }: ActionCardProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionCard,
        {
          backgroundColor: disabled ? theme.colors.surfaceMuted : theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.actionIconWrap, { backgroundColor: disabled ? theme.colors.surfaceElevated : theme.colors.primarySoft }]}>
        {icon}
      </View>
      <Text style={[styles.actionTitle, { color: disabled ? theme.colors.textSubtle : theme.colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.actionSubtitle, { color: disabled ? theme.colors.textSubtle : theme.colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </Pressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
    },
    menuStack: {
      gap: Space.xl,
    },
    mediaSection: {
      gap: Space.md,
    },
    mediaSectionTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    cardGrid: {
      flexDirection: 'row',
      gap: Space.md,
    },
    stack: {
      gap: Space.md,
    },
    actionCard: {
      flex: 1,
      minHeight: 92,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.lg,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      gap: Space.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionIconWrap: {
      width: 36,
      height: 36,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      textAlign: 'center',
    },
    actionSubtitle: {
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    inlineHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
    },
    invalidStatusRow: {
      alignItems: 'flex-end',
      marginTop: Space.xs,
    },
    statusText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    helperText: {
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    previewImage: {
      width: '100%',
      aspectRatio: 1.2,
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceMuted,
    },
    previewHero: {
      position: 'relative',
    },
    previewDeleteButton: {
      position: 'absolute',
      top: Space.sm,
      right: Space.sm,
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...createSurfaceStyle(colors, scheme, 'floating'),
    },
    previewStack: {
      gap: Space.sm,
    },
    previewStrip: {
      gap: Space.sm,
      paddingRight: Space.xs,
    },
    previewThumbWrap: {
      borderRadius: Radius.md,
      borderWidth: BorderWidth.strong,
      overflow: 'hidden',
    },
    previewThumb: {
      width: 72,
      height: 72,
      backgroundColor: colors.surfaceMuted,
    },
  });
}
