import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CharacterId, CustomCharacter, GroupProfile, MorningPlan, WakeToOutRecord } from "./types";

const PLAN_KEY = "out-mvp-plan-v1";
const HISTORY_KEY = "out-mvp-history-v1";
const ACTIVE_WAKE_KEY = "out-mvp-active-wake-v1";
const GROUP_KEY = "out-mvp-group-v1";
const CHARACTER_KEY = "out-ai-character-v1";
const CUSTOM_CHARACTER_KEY = "out-ai-custom-character-v1";
const CHARACTER_ENABLED_KEY = "out-character-enabled-v1";
const BLOCKED_USERS_KEY = "out-blocked-users-v1";

export async function loadOutState() {
  const [planRaw, historyRaw, activeWakeRaw, groupRaw, characterRaw, customCharacterRaw, characterEnabledRaw] = await Promise.all([AsyncStorage.getItem(PLAN_KEY), AsyncStorage.getItem(HISTORY_KEY), AsyncStorage.getItem(ACTIVE_WAKE_KEY), AsyncStorage.getItem(GROUP_KEY), AsyncStorage.getItem(CHARACTER_KEY), AsyncStorage.getItem(CUSTOM_CHARACTER_KEY), AsyncStorage.getItem(CHARACTER_ENABLED_KEY)]);
  return { plan: parseJson<MorningPlan | null>(planRaw, null), history: parseJson<WakeToOutRecord[]>(historyRaw, []), activeWakeAt: activeWakeRaw ? Number(activeWakeRaw) : null, group: parseJson<GroupProfile | null>(groupRaw, null), character: parseJson<CharacterId>(characterRaw, "kind"), customCharacter: parseJson<CustomCharacter>(customCharacterRaw, { name: "MY VOICE", personality: "친한 친구처럼 솔직하고 재치 있게 말한다." }), characterEnabled: parseJson<boolean>(characterEnabledRaw, true) };
}

export const savePlan = (plan: MorningPlan) => AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
export const saveHistory = (history: WakeToOutRecord[]) => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
export const saveCharacter = (character: CharacterId) => AsyncStorage.setItem(CHARACTER_KEY, JSON.stringify(character));
export const saveCustomCharacter = (character: CustomCharacter) => AsyncStorage.setItem(CUSTOM_CHARACTER_KEY, JSON.stringify(character));
export const saveCharacterEnabled = (enabled: boolean) => AsyncStorage.setItem(CHARACTER_ENABLED_KEY, JSON.stringify(enabled));
export async function loadBlockedUsers() {
  return parseJson<string[]>(await AsyncStorage.getItem(BLOCKED_USERS_KEY), []);
}
export const saveBlockedUsers = (ids: string[]) => AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(ids));
export async function clearOutLocalData() {
  await AsyncStorage.multiRemove([PLAN_KEY, HISTORY_KEY, ACTIVE_WAKE_KEY, GROUP_KEY, CHARACTER_KEY, CUSTOM_CHARACTER_KEY, CHARACTER_ENABLED_KEY, BLOCKED_USERS_KEY]);
}
export async function saveGroup(group: GroupProfile | null) {
  if (group === null) return AsyncStorage.removeItem(GROUP_KEY);
  return AsyncStorage.setItem(GROUP_KEY, JSON.stringify(group));
}
export async function saveActiveWake(wakeAt: number | null) {
  if (wakeAt === null) return AsyncStorage.removeItem(ACTIVE_WAKE_KEY);
  return AsyncStorage.setItem(ACTIVE_WAKE_KEY, String(wakeAt));
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
