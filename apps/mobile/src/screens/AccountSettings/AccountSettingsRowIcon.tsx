import React from 'react';
import {
  BookOpen, Bug, Cable, CircleHelp, Code2, FileText, Globe2,
  History, Image, Info, Languages, LayoutGrid, LockOpen, Megaphone, MessageCircle,
  Palette, Plus, RotateCcw, Settings2, Share2, ShieldCheck, Star, Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
import type { AccountSettingsSectionRow } from './section-model';

const icons: Readonly<Record<string, LucideIcon>> = {
  theme: Palette, accent: Palette, 'chat-appearance': MessageCircle, 'app-icon': Image,
  'app-language': Languages,
  'help-center': CircleHelp, feedback: MessageCircle, 'release-notes': History,
  'openclaw-docs': BookOpen, 'hermes-docs': BookOpen, 'openclaw-releases': Globe2,
  discord: MessageCircle, share: Share2, rate: Star,
  version: Info, repository: Code2, privacy: ShieldCheck, terms: FileText,
  'advanced-settings': Settings2, 'set-debug-mode': Bug, 'preview-environment': Globe2,
  'design-system': LayoutGrid, 'preview-update-announcement': Megaphone,
  'set-simulate-free-account': LockOpen,
  'clear-cache': Trash2, 'reset-device': RotateCcw,
  'restore-purchases': RotateCcw, 'add-connection': Plus, 'reconnect-connection': RotateCcw,
  'remove-connection': Trash2, 'set-free-connection': Cable,
};

export function accountSettingsRowHasIcon(row: AccountSettingsSectionRow): boolean {
  return Boolean(icons[row.action ?? row.id]);
}

export function AccountSettingsRowIcon({ row }: { row: AccountSettingsSectionRow }): React.JSX.Element | null {
  const icon = icons[row.action ?? row.id];
  return icon ? <SettingsIcon icon={icon} tone="neutral" size={20} strokeWidth={1.75} /> : null;
}
