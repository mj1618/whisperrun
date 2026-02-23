export interface QuickCommMessage {
  id: string;
  text: string;
  color: string;
  icon: string;
  key: string;
  sound: "urgent" | "info" | "celebrate";
  duration: number;
}

export const QUICK_COMM_MESSAGES: QuickCommMessage[] = [
  { id: "stop", text: "STOP!", color: "#FF4444", icon: "\u{1F6D1}", key: "Q", sound: "urgent", duration: 2500 },
  { id: "go", text: "GO NOW!", color: "#44FF44", icon: "\u25B6", key: "W", sound: "info", duration: 2000 },
  { id: "behind", text: "BEHIND YOU!", color: "#FF6B6B", icon: "\u26A0", key: "E", sound: "urgent", duration: 2500 },
  { id: "hide", text: "HIDE!", color: "#FFB74D", icon: "\u{1FAE3}", key: "R", sound: "urgent", duration: 2000 },
  { id: "safe", text: "You're safe", color: "#81C784", icon: "\u2713", key: "T", sound: "info", duration: 2000 },
  { id: "nice", text: "Nice move!", color: "#FFD700", icon: "\u2605", key: "Y", sound: "celebrate", duration: 1800 },
];

export const QUICK_COMM_COOLDOWN_MS = 1500;
