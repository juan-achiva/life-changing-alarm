import type { MorningPlan, WakeToOutRecord } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function buildMorningPlan(input: {
  eventTitle: string;
  eventTime: string;
  travelMinutes: number;
  prepMinutes: number;
  history: WakeToOutRecord[];
}): MorningPlan {
  const [hour, minute] = input.eventTime.split(":").map(Number);
  const eventAt = new Date();
  eventAt.setHours(hour, minute, 0, 0);
  if (eventAt.getTime() <= Date.now()) eventAt.setTime(eventAt.getTime() + DAY);

  const recent = input.history.slice(0, 3);
  const observed = recent.length
    ? recent.reduce((sum, record) => sum + record.durationSeconds / 60, 0) / recent.length
    : input.prepMinutes;
  const adjustmentMinutes = clamp(Math.round(observed - input.prepMinutes), -10, 30);
  const targetOutAt = eventAt.getTime() - input.travelMinutes * MINUTE;
  const wakeAt = targetOutAt - (input.prepMinutes + adjustmentMinutes) * MINUTE;

  return { id: `plan-${Date.now()}`, eventTitle: input.eventTitle.trim() || "MORNING SCHEDULE", eventTime: input.eventTime, travelMinutes: input.travelMinutes, prepMinutes: input.prepMinutes, wakeAt, targetOutAt, adjustmentMinutes };
}

export function getCoachMessage(remainingSeconds: number) {
  if (remainingSeconds <= 0) return "OUT time passed. Grab the essentials and leave now.";
  if (remainingSeconds <= 5 * 60) return "Shoes, keys, phone. It is time to move.";
  if (remainingSeconds <= 15 * 60) return "Start your final departure routine now.";
  return "Stay on pace. I’ll tell you when it’s time to move.";
}

export function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const body = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${body}` : body;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
