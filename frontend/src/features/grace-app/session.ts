import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "life-changing-alarm-session-user-id";

export async function loadStoredSessionUserId() {
  return await AsyncStorage.getItem(SESSION_KEY);
}

export async function persistSessionUserId(userId: string) {
  await AsyncStorage.setItem(SESSION_KEY, userId);
}

export async function clearStoredSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}
