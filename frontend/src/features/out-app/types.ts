export type MorningPlan = {
  id: string;
  eventTitle: string;
  eventTime: string;
  travelMinutes: number;
  prepMinutes: number;
  wakeAt: number;
  lastCallAt?: number;
  targetOutAt: number;
  adjustmentMinutes: number;
  repeatDays?: number[];
};

export type WakeToOutRecord = {
  id: string;
  groupId?: string;
  wakeAt: number;
  outAt: number;
  targetOutAt: number;
  durationSeconds: number;
  deltaSeconds: number;
  photoUri: string | null;
  authorName?: string;
  aiComment?: string;
  aiCharacter?: CharacterId;
  aiCharacterName?: string;
  departureMode?: "ready" | "last-call";
  authorUserId?: string;
  photoKey?: string;
};

export type CharacterId = "kind" | "tough" | "analyst" | "hype" | "custom";

export type CustomCharacter = {
  name: string;
  personality: string;
};

export type AppPhase = "tomorrow" | "alarm" | "outAlarm" | "timer" | "result";

export type GroupProfile = {
  id: string;
  name: string;
  inviteCode: string;
  memberName: string;
  memberNames: string[];
};
