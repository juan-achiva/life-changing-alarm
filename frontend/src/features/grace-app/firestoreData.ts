import type { GracePost } from "@/src/features/grace-app/mockData";
import { defaultNotificationSettings, type AppUser, type GroupSummary } from "@/src/features/grace-app/types";

export const demoUserProfile: AppUser = {
  id: "demo-user",
  provider: "kakao",
  providerUserId: "demo-user",
  displayName: "민수",
  email: "demo@grace.app",
  groupId: "demo-group",
  groupName: "청년부 2조",
  role: "owner",
  notificationSettings: {
    ...defaultNotificationSettings,
    dailyReminderEnabled: true,
    reminderPromptSeen: true,
    reminderHour: 21,
    reminderMinute: 0,
    groupPostEnabled: true,
  },
  pushTokens: [],
  blockedUserIds: [],
  legalConsentVersion: "demo",
  legalConsentAcceptedAtMs: Date.now(),
};

export const demoGroup: GroupSummary = {
  id: "demo-group",
  name: "청년부 2조",
  inviteCode: "GRACE7",
  memberCount: 3,
  maxMembers: 7,
  subscriptionTier: "free",
  ownerUserId: "demo-user",
  memberNames: ["민수", "지현", "하은"],
  memberProfiles: [
    { userId: "demo-user", displayName: "민수" },
    { userId: "demo-user-2", displayName: "지현" },
    { userId: "demo-user-3", displayName: "하은" },
  ],
  prayerRequests: {},
};

export const demoPostsByGroup: GracePost[] = [
  {
    id: "demo-1",
    authorId: "demo-user",
    authorName: "민수",
    groupId: "demo-group",
    groupName: "청년부 2조",
    verseText: "너는 마음을 다하여 여호와를 신뢰하고 네 명철을 의지하지 말라.",
    verseReference: "잠언 3장 5절",
    caption: "봉사 끝나고 비친 오후 햇살이 오래 남았어요.",
    createdLabel: "오늘 오후 2:10",
    createdAtMs: new Date("2026-04-13T14:10:00+09:00").getTime(),
    palette: ["#E8C27A", "#D48F5D", "#F8EFE0"],
  },
  {
    id: "demo-2",
    authorId: "demo-user-2",
    authorName: "지현",
    groupId: "demo-group",
    groupName: "청년부 2조",
    verseText: "두려워하지 말라 내가 너와 함께 함이라 놀라지 말라 나는 네 하나님이 됨이라.",
    verseReference: "이사야 41장 10절",
    caption: "예배 전에 본 하늘이 참 맑아서 마음이 고요해졌어요.",
    createdLabel: "오늘 오전 9:20",
    createdAtMs: new Date("2026-04-13T09:20:00+09:00").getTime(),
    palette: ["#B9CBB6", "#EEE5D7", "#8B9C7C"],
  },
];
