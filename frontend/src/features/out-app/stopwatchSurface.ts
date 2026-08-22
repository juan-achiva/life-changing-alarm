import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { NativeModules, Platform } from "react-native";

const NOTIFICATION_KEY = "out.stopwatch.notification-id";

type NativeStopwatchSurface = {
  start: (wakeAt: number, targetOutAt: number) => Promise<void>;
  stop: (outAt: number) => Promise<void>;
};

const nativeSurface = NativeModules.OutStopwatchSurface as NativeStopwatchSurface | undefined;

export async function startStopwatchSurface(wakeAt: number, targetOutAt: number) {
  if (nativeSurface) {
    await nativeSurface.start(wakeAt, targetOutAt);
    return;
  }

  // Expo Go fallback. Development builds replace this with an Android ongoing
  // chronometer notification and an iOS Live Activity using the same timestamps.
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "⏱ WAKE → OUT",
      body: `${clock(wakeAt)}부터 스톱워치 진행 중 · 탭해서 돌아가기`,
      sound: false,
      sticky: Platform.OS === "android",
      autoDismiss: Platform.OS !== "android",
      data: { kind: "wake-to-out-stopwatch", wakeAt, targetOutAt },
    },
    trigger: null,
  });
  await AsyncStorage.setItem(NOTIFICATION_KEY, id);
}

export async function stopStopwatchSurface(outAt: number) {
  if (nativeSurface) await nativeSurface.stop(outAt);
  const id = await AsyncStorage.getItem(NOTIFICATION_KEY);
  if (id) await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  await AsyncStorage.removeItem(NOTIFICATION_KEY);
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
