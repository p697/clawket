import React from 'react';
import { useChatController } from '../../chat/useChatController';

export type ChatController = ReturnType<typeof useChatController>;

const ChatControllerContext = React.createContext<ChatController | null>(null);

type ChatControllerProviderProps = {
  controller: ChatController;
  children: React.ReactNode;
};

export function ChatControllerProvider({ controller, children }: ChatControllerProviderProps): React.JSX.Element {
  return <ChatControllerContext.Provider value={controller}>{children}</ChatControllerContext.Provider>;
}

export function useChatControllerContext(): ChatController {
  const context = React.useContext(ChatControllerContext);
  if (!context) {
    throw new Error('useChatControllerContext must be used within ChatControllerProvider');
  }
  return context;
}
