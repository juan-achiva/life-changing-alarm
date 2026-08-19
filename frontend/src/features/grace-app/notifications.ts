import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { NotificationSettings } from "@/src/features/grace-app/types";

export const REMINDER_TIME_OPTIONS = [
  { hour: 7, minute: 30, label: "오전 7:30" },
  { hour: 12, minute: 0, label: "오후 12:00" },
  { hour: 21, minute: 0, label: "오후 9:00" },
  { hour: 22, minute: 0, label: "오후 10:00" },
] as const;

const DAILY_REMINDER_KIND = "daily-grace-reminder";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function formatReminderTime(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export async function requestNotificationPermission() {
  await ensureNotificationChannel();

  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") {
    return true;
  }

  const next = await Notifications.requestPermissionsAsync();
  return next.status === "granted";
}

export async function syncDailyReminderNotification(settings: NotificationSettings) {
  await ensureNotificationChannel();
  await clearDailyReminderNotifications();

  if (!settings.dailyReminderEnabled) {
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "오늘의 은혜를 공유하실 시간입니다",
      body: "오늘 받은 은혜를 사진과 말씀으로 남겨보세요.",
      sound: "default",
      data: {
        kind: DAILY_REMINDER_KIND,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: Platform.OS === "android" ? "default" : undefined,
      hour: settings.reminderHour,
      minute: settings.reminderMinute,
    },
  });
}

export async function getExpoPushTokenValue() {
  await ensureNotificationChannel();

  const projectId =
    Constants.easConfig?.projectId ||
    (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra?.eas?.projectId;

  const token = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();

  return token.data;
}

async function clearDailyReminderNotifications() {
  const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
  const reminderNotifications = scheduledNotifications.filter(
    (item) => (item.content.data as { kind?: string } | undefined)?.kind === DAILY_REMINDER_KIND,
  );

  await Promise.all(
    reminderNotifications.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

async function ensureNotificationChannel() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync("default", {
    name: "기본 알림",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
