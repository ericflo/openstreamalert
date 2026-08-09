export type ChatFragment =
  | { type: "text" | "mention"; text: string }
  | { type: "emote"; text: string; id: string }
  | { type: "cheermote"; text: string; bits: number };

export interface ChatMessage {
  kind: "message";
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  badges: Array<{
    setId: string;
    id: string;
    imageUrl?: string;
    title?: string;
  }>;
  fragments: ChatFragment[];
  text: string;
  sentAt: string;
  reply?: { userName: string; text: string };
  action: boolean;
}

export type OverlayEvent =
  | ChatMessage
  | { kind: "notice"; id: string; text: string; sentAt: string }
  | { kind: "delete"; messageId: string }
  | { kind: "clear-user"; userId: string }
  | { kind: "clear" }
  | {
      kind: "state";
      state: "connecting" | "connected" | "reconnecting" | "error";
      detail?: string;
    };
