export type AuthProviderType = "apple" | "kakao";

export type NotificationSettings = {
  dailyReminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  groupPostEnabled: boolean;
  reminderPromptSeen: boolean;
};

export type GroupSubscriptionTier = "free" | "growth";

export type GroupMemberProfile = {
  userId?: string;
  displayName: string;
};

export type GroupPrayerRequest = {
  content: string;
  targetDateKey: string;
  updatedAtMs: number;
  memberUserId?: string;
  memberName?: string;
};

export const defaultNotificationSettings: NotificationSettings = {
  dailyReminderEnabled: false,
  reminderHour: 21,
  reminderMinute: 0,
  groupPostEnabled: false,
  reminderPromptSeen: false,
};

export function withDefaultNotificationSettings(
  settings?: Partial<NotificationSettings> | null,
): NotificationSettings {
  return {
    ...defaultNotificationSettings,
    ...(settings ?? {}),
  };
}

export type AppUser = {
  id: string;
  provider: AuthProviderType;
  providerUserId: string;
  displayName: string;
  email: string | null;
  groupId: string | null;
  groupName: string | null;
  role: "owner" | "member" | null;
  notificationSettings: NotificationSettings;
  pushTokens: string[];
  blockedUserIds: string[];
  legalConsentVersion: string | null;
  legalConsentAcceptedAtMs: number | null;
};

export type GroupSummary = {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  maxMembers: number;
  subscriptionTier: GroupSubscriptionTier;
  ownerUserId: string;
  memberNames: string[];
  memberProfiles: GroupMemberProfile[];
  prayerRequests: Record<string, GroupPrayerRequest>;
};

export type SocialIdentity = {
  provider: AuthProviderType;
  providerUserId: string;
  displayName: string;
  email: string | null;
};
