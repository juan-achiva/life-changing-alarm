import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MorningPlan, WakeToOutRecord } from "./types";

const PLAN_KEY = "out-mvp-plan-v1";
const HISTORY_KEY = "out-mvp-history-v1";
const ACTIVE_WAKE_KEY = "out-mvp-active-wake-v1";

export async function loadOutState() {
  const [planRaw, historyRaw, activeWakeRaw] = await Promise.all([AsyncStorage.getItem(PLAN_KEY), AsyncStorage.getItem(HISTORY_KEY), AsyncStorage.getItem(ACTIVE_WAKE_KEY)]);
  return { plan: parseJson<MorningPlan | null>(planRaw, null), history: parseJson<WakeToOutRecord[]>(historyRaw, []), activeWakeAt: activeWakeRaw ? Number(activeWakeRaw) : null };
}

export const savePlan = (plan: MorningPlan) => AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
export const saveHistory = (history: WakeToOutRecord[]) => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
export async function saveActiveWake(wakeAt: number | null) {
  if (wakeAt === null) return AsyncStorage.removeItem(ACTIVE_WAKE_KEY);
  return AsyncStorage.setItem(ACTIVE_WAKE_KEY, String(wakeAt));
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
