import type { ChatMessage, OverlayEvent } from "../../shared/events";

export const demoMessages: ChatMessage[] = [
  {
    kind: "message",
    id: "demo-1",
    userId: "1",
    userName: "mossybytes",
    userColor: "#5eead4",
    badges: [{ setId: "subscriber", id: "12" }],
    text: "That lighting looks so good tonight",
    fragments: [{ type: "text", text: "That lighting looks so good tonight" }],
    sentAt: new Date(Date.now() - 15_000).toISOString(),
    action: false,
    firstMessage: false,
  },
  {
    kind: "message",
    id: "demo-2",
    userId: "2",
    userName: "pixelpal",
    userColor: "#c4b5fd",
    badges: [{ setId: "moderator", id: "1" }],
    text: "We are so back Kappa",
    fragments: [
      { type: "text", text: "We are so back " },
      { type: "emote", text: "Kappa", id: "25" },
    ],
    sentAt: new Date(Date.now() - 8_000).toISOString(),
    reply: {
      userName: "mossybytes",
      text: "That lighting looks so good tonight",
    },
    action: false,
    firstMessage: false,
  },
  {
    kind: "message",
    id: "demo-3",
    userId: "3",
    userName: "orbitalsoup",
    userColor: "#fda4af",
    badges: [],
    text: "first try. calling it now ✨",
    fragments: [{ type: "text", text: "first try. calling it now ✨" }],
    sentAt: new Date().toISOString(),
    action: false,
    firstMessage: true,
  },
];

export function makeDemoMessage(index: number): OverlayEvent {
  const samples = [
    ["softserve", "#f9a8d4", "This overlay is ridiculously clean"],
    ["northstar", "#93c5fd", "hello from the test button 👋"],
    ["tinywizard", "#fde68a", "the vibes are immaculate"],
  ];
  const [userName, userColor, text] = samples[index % samples.length];
  return {
    kind: "message",
    id: `test-${Date.now()}`,
    userId: `test-${index}`,
    userName,
    userColor,
    badges: [],
    fragments: [{ type: "text", text }],
    text,
    sentAt: new Date().toISOString(),
    action: false,
    firstMessage: false,
  };
}
