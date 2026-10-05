import { Brain, CalendarClock, FilePenLine, FileSearch, Globe, MessageCircleQuestion, MessageSquare, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react-native';
import { isQuestionTool, toolCategory } from '../../utils/tool-display';

/** One glyph per kind of tool, shared by the work dock and the work record rows. */
export function toolIcon(name: string): LucideIcon {
  if (isQuestionTool(name)) return MessageCircleQuestion;
  switch (toolCategory(name)) {
    case 'command': return Terminal;
    case 'read': return FileSearch;
    case 'edit': return FilePenLine;
    case 'search': return Search;
    case 'memory': return Brain;
    case 'web': return Globe;
    case 'schedule': return CalendarClock;
    case 'message': return MessageSquare;
    default: return Wrench;
  }
}
