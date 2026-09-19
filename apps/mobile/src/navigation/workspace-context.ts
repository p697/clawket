import { createContext, useContext } from 'react';

export const WorkspaceContext = createContext<{
  tablet: boolean;
  paneWidth: number;
  toggleRoster?: () => void;
  dismissRoster?: () => void;
}>({ tablet: false, paneWidth: 0 });

export const useWorkspaceLayout = () => useContext(WorkspaceContext);

