import { createContext, useContext } from 'react';

export const WorkspaceContext = createContext<{
  constrainContent: boolean;
  paneWidth?: number;
  toggleRoster?: () => void;
  dismissRoster?: () => void;
}>({ constrainContent: false });

export const useWorkspaceLayout = () => useContext(WorkspaceContext);

