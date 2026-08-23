import type { MorningPlan, WakeToOutRecord } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LAST_CALL_LEAD = 10 * MINUTE;

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

  return { id: `plan-${Date.now()}`, eventTitle: input.eventTitle.trim() || "MORNING SCHEDULE", eventTime: input.eventTime, travelMinutes: input.travelMinutes, prepMinutes: input.prepMinutes, wakeAt, lastCallAt: calculateLastCallAt(wakeAt, targetOutAt), targetOutAt, adjustmentMinutes };
}

export function buildWakeAlarmPlan(input: {
  label: string;
  wakeTime: string;
  outTime: string;
  repeatDays?: number[];
}): MorningPlan {
  const wakeAt = nextTimestamp(input.wakeTime);
  let targetOutAt = timestampOnSameDay(input.outTime, wakeAt);
  if (targetOutAt <= wakeAt) targetOutAt += DAY;
  const prepMinutes = Math.max(1, Math.round((targetOutAt - wakeAt) / MINUTE));
  return {
    id: `alarm-${Date.now()}`,
    eventTitle: input.label.trim() || "기상 알람",
    eventTime: input.wakeTime,
    travelMinutes: 0,
    prepMinutes,
    wakeAt,
    lastCallAt: calculateLastCallAt(wakeAt, targetOutAt),
    targetOutAt,
    adjustmentMinutes: 0,
    repeatDays: input.repeatDays ?? [],
  };
}

export function getLastCallAt(plan: Pick<MorningPlan, "wakeAt" | "lastCallAt" | "targetOutAt">) {
  return plan.lastCallAt ?? calculateLastCallAt(plan.wakeAt, plan.targetOutAt);
}

function calculateLastCallAt(wakeAt: number, targetOutAt: number) {
  const preferred = targetOutAt - LAST_CALL_LEAD;
  if (preferred > wakeAt) return preferred;
  return wakeAt + Math.max(1, Math.floor((targetOutAt - wakeAt) / 2 / MINUTE)) * MINUTE;
}

export function getCoachMessage(remainingSeconds: number) {
  if (remainingSeconds <= 0) return "출발 시간이 지났습니다. 필수품만 챙기고 지금 나가세요.";
  if (remainingSeconds <= 60) return "현관으로 이동하세요. 지금 신발을 신어야 합니다.";
  if (remainingSeconds <= 3 * 60) return "휴대폰, 열쇠, 가방. 바로 나갈 준비를 하세요.";
  if (remainingSeconds <= 5 * 60) return "5분도 남지 않았습니다. 준비를 끝내세요.";
  if (remainingSeconds <= 10 * 60) return "LAST CALL. 최소 루틴만 끝내고 나가세요.";
  if (remainingSeconds <= 15 * 60) return "이제 출발 준비를 마무리할 시간입니다.";
  return "지금 페이스를 유지하세요. LAST CALL 전에 알려드릴게요.";
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

function nextTimestamp(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const now = new Date();
  if (now.getHours() === hour && now.getMinutes() === minute) return Date.now() + 1_500;
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) date.setTime(date.getTime() + DAY);
  return date.getTime();
}

function timestampOnSameDay(time: string, reference: number) {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(reference);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}
