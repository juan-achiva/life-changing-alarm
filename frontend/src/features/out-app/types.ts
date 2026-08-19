export type MorningPlan = {
  id: string;
  eventTitle: string;
  eventTime: string;
  travelMinutes: number;
  prepMinutes: number;
  wakeAt: number;
  targetOutAt: number;
  adjustmentMinutes: number;
};

export type WakeToOutRecord = {
  id: string;
  wakeAt: number;
  outAt: number;
  targetOutAt: number;
  durationSeconds: number;
  deltaSeconds: number;
  photoUri: string | null;
};

export type AppPhase = "tomorrow" | "alarm" | "timer" | "result";
