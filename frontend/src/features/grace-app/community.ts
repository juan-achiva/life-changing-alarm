import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from "firebase/firestore";

import { db, isFirebaseConfigured } from "@/src/lib/firebase";
import { LEGAL_CONSENT_VERSION } from "@/src/features/grace-app/legal";
import {
  withDefaultNotificationSettings,
  type AppUser,
  type GroupMemberProfile,
  type GroupPrayerRequest,
  type GroupSubscriptionTier,
  type GroupSummary,
  type NotificationSettings,
  type SocialIdentity,
} from "@/src/features/grace-app/types";

const FREE_GROUP_MEMBER_LIMIT = 7;
const GROWTH_GROUP_MEMBER_LIMIT = 20;

type FirestoreUser = {
  provider: AppUser["provider"];
  providerUserId: string;
  socialKey?: string;
  displayName: string;
  email: string | null;
  groupId?: string | null;
  groupName?: string | null;
  role?: AppUser["role"];
  legacyUserId?: string | null;
  notificationSettings?: Partial<NotificationSettings>;
  pushTokens?: string[];
  blockedUserIds?: string[];
  legalConsentVersion?: string | null;
  legalConsentAcceptedAtMs?: number | null;
};

type FirestoreGroup = {
  name: string;
  inviteCode: string;
  memberCount: number;
  maxMembers: number;
  subscriptionTier?: GroupSubscriptionTier;
  ownerUserId: string;
  memberNames?: string[];
  memberProfiles?: GroupMemberProfile[];
  prayerRequests?: Record<string, GroupPrayerRequest>;
};

export async function upsertSocialUser(userId: string, identity: SocialIdentity) {
  ensureFirebase();

  const userRef = doc(db!, "users", userId);
  const socialKey = `${identity.provider}:${identity.providerUserId}`;
  const existingSnapshot = await getDoc(userRef).catch(() => null);
  const existingData = existingSnapshot?.exists() ? (existingSnapshot.data() as FirestoreUser) : null;
  const nextDisplayName = shouldKeepExistingDisplayName(existingData?.displayName, identity.displayName)
    ? existingData?.displayName ?? identity.displayName
    : identity.displayName;
  const nextNotificationSettings = withDefaultNotificationSettings(existingData?.notificationSettings);

  await setDoc(
    userRef,
    {
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      socialKey,
      displayName: nextDisplayName,
      email: identity.email ?? existingData?.email ?? null,
      groupId: existingData?.groupId ?? null,
      groupName: existingData?.groupName ?? null,
      role: existingData?.role ?? null,
      notificationSettings: nextNotificationSettings,
      pushTokens: existingData?.pushTokens ?? [],
      blockedUserIds: existingData?.blockedUserIds ?? [],
      legalConsentVersion: existingData?.legalConsentVersion ?? null,
      legalConsentAcceptedAtMs: existingData?.legalConsentAcceptedAtMs ?? null,
      legacyUserId: existingData?.legacyUserId ?? null,
      updatedAt: serverTimestamp(),
      ...(existingData ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );

  return {
    user: {
      id: userId,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      displayName: nextDisplayName,
      email: identity.email ?? existingData?.email ?? null,
      groupId: existingData?.groupId ?? null,
      groupName: existingData?.groupName ?? null,
      role: existingData?.role ?? null,
      notificationSettings: nextNotificationSettings,
      pushTokens: existingData?.pushTokens ?? [],
      blockedUserIds: existingData?.blockedUserIds ?? [],
      legalConsentVersion: existingData?.legalConsentVersion ?? null,
      legalConsentAcceptedAtMs: existingData?.legalConsentAcceptedAtMs ?? null,
    },
    needsLegalConsent: !existingData,
  };
}

export async function acceptLegalConsents(userId: string) {
  ensureFirebase();

  const acceptedAtMs = Date.now();

  await setDoc(
    doc(db!, "users", userId),
    {
      legalConsentVersion: LEGAL_CONSENT_VERSION,
      legalConsentAcceptedAtMs: acceptedAtMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return {
    legalConsentVersion: LEGAL_CONSENT_VERSION,
    legalConsentAcceptedAtMs: acceptedAtMs,
  };
}

export async function renameUserDisplayName(user: AppUser, nextDisplayName: string) {
  ensureFirebase();

  const trimmedName = nextDisplayName.trim();
  if (!trimmedName) {
    throw new Error("표시할 이름을 입력해 주세요.");
  }

  const userRef = doc(db!, "users", user.id);

  if (!user.groupId) {
    await setDoc(
      userRef,
      {
        displayName: trimmedName,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  const groupRef = doc(db!, "groups", user.groupId);

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists()) {
      throw new Error("사용자 정보를 찾지 못했어요.");
    }

    transaction.set(
      userRef,
      {
        displayName: trimmedName,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (groupSnap.exists()) {
      const groupData = groupSnap.data() as FirestoreGroup;
      transaction.set(
        groupRef,
        {
          memberNames: replaceOneMemberName(groupData.memberNames ?? [], user.displayName, trimmedName),
          memberProfiles: replaceOneMemberProfile(
            groupData.memberProfiles ?? [],
            user.id,
            user.displayName,
            trimmedName,
          ),
          prayerRequests: migratePrayerRequestOwner(
            groupData.prayerRequests ?? {},
            user.id,
            user.displayName,
            trimmedName,
          ),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
}

export async function updateNotificationSettings(
  userId: string,
  partialSettings: Partial<NotificationSettings>,
) {
  ensureFirebase();

  const userRef = doc(db!, "users", userId);
  const existingSnapshot = await getDoc(userRef);
  const existingData = existingSnapshot.exists() ? (existingSnapshot.data() as FirestoreUser) : null;
  const nextNotificationSettings = withDefaultNotificationSettings({
    ...existingData?.notificationSettings,
    ...partialSettings,
  });

  await setDoc(
    userRef,
    {
      notificationSettings: nextNotificationSettings,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function registerExpoPushToken(userId: string, pushToken: string) {
  ensureFirebase();

  const trimmedToken = pushToken.trim();
  if (!trimmedToken) {
    throw new Error("푸시 토큰이 비어 있어요.");
  }

  await setDoc(
    doc(db!, "users", userId),
    {
      pushTokens: arrayUnion(trimmedToken),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function blockUserProfile(userId: string, targetUserId: string) {
  ensureFirebase();

  const trimmedTargetUserId = targetUserId.trim();
  if (!trimmedTargetUserId) {
    throw new Error("차단할 사용자를 확인하지 못했어요.");
  }

  if (trimmedTargetUserId === userId) {
    throw new Error("내 계정은 차단할 수 없어요.");
  }

  await setDoc(
    doc(db!, "users", userId),
    {
      blockedUserIds: arrayUnion(trimmedTargetUserId),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function subscribeUserProfile(
  userId: string,
  onChange: (user: AppUser | null) => void,
  onError: (error: Error) => void,
) {
  if (!isFirebaseConfigured || !db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, "users", userId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }

      onChange(mapUser(snapshot.id, snapshot.data() as FirestoreUser));
    },
    (error) => onError(error as Error),
  );
}

export function subscribeGroup(
  groupId: string,
  onChange: (group: GroupSummary | null) => void,
  onError: (error: Error) => void,
) {
  if (!isFirebaseConfigured || !db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, "groups", groupId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }

      onChange(mapGroup(snapshot.id, snapshot.data() as FirestoreGroup));
    },
    (error) => onError(error as Error),
  );
}

export async function createGroupForUser(user: AppUser, groupName: string) {
  ensureFirebase();

  const trimmedName = groupName.trim();
  if (!trimmedName) {
    throw new Error("그룹 이름을 입력해 주세요.");
  }

  const userRef = doc(db!, "users", user.id);
  const groupRef = doc(collection(db!, "groups"));

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error("사용자 정보를 찾지 못했어요.");
    }

    const userData = userSnap.data() as FirestoreUser;
    if (userData.groupId) {
      throw new Error("이미 그룹에 속해 있어요.");
    }

    transaction.set(groupRef, {
      name: trimmedName,
      inviteCode: generateInviteCode(),
      memberCount: 1,
      maxMembers: FREE_GROUP_MEMBER_LIMIT,
      subscriptionTier: "free",
      ownerUserId: user.id,
      memberNames: [user.displayName],
      memberProfiles: [{ userId: user.id, displayName: user.displayName }],
      prayerRequests: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      userRef,
      {
        groupId: groupRef.id,
        groupName: trimmedName,
        role: "owner",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function joinGroupWithInviteCode(user: AppUser, inviteCode: string) {
  ensureFirebase();

  const normalizedCode = inviteCode.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error("초대 코드를 입력해 주세요.");
  }

  const groupsQuery = query(
    collection(db!, "groups"),
    where("inviteCode", "==", normalizedCode),
    limit(1),
  );
  const groupsSnapshot = await getDocs(groupsQuery);

  if (groupsSnapshot.empty) {
    throw new Error("유효한 초대 코드를 찾지 못했어요.");
  }

  const groupRef = groupsSnapshot.docs[0].ref;
  const userRef = doc(db!, "users", user.id);

  await runTransaction(db!, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const userSnap = await transaction.get(userRef);

    if (!groupSnap.exists() || !userSnap.exists()) {
      throw new Error("그룹 또는 사용자 정보를 찾지 못했어요.");
    }

    const groupData = groupSnap.data() as FirestoreGroup;
    const userData = userSnap.data() as FirestoreUser;

    if (userData.groupId) {
      throw new Error("이미 그룹에 속해 있어요.");
    }

    const maxMembers = resolveGroupMaxMembers(groupData);

    if (groupData.memberCount >= maxMembers) {
      throw new Error(`이 그룹은 최대 ${maxMembers}명까지라 더 이상 초대할 수 없어요.`);
    }

    const nextNames = [...(groupData.memberNames ?? []), user.displayName];
    const nextProfiles = [...(groupData.memberProfiles ?? []), { userId: user.id, displayName: user.displayName }];

    transaction.set(
      groupRef,
      {
        memberCount: groupData.memberCount + 1,
        memberNames: nextNames,
        memberProfiles: nextProfiles,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    transaction.set(
      userRef,
      {
        groupId: groupRef.id,
        groupName: groupData.name,
        role: "member",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function regenerateInviteCode(user: AppUser, group: GroupSummary) {
  ensureFirebase();

  const userRef = doc(db!, "users", user.id);
  const groupRef = doc(db!, "groups", group.id);

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists() || !groupSnap.exists()) {
      throw new Error("그룹 또는 사용자 정보를 찾지 못했어요.");
    }

    const userData = userSnap.data() as FirestoreUser;
    const groupData = groupSnap.data() as FirestoreGroup;

    if (userData.groupId !== group.id || groupData.ownerUserId !== user.id) {
      throw new Error("초대 코드는 그룹 오너만 다시 만들 수 있어요.");
    }

    transaction.set(
      groupRef,
      {
        inviteCode: generateInviteCode(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function renameGroupName(user: AppUser, group: GroupSummary, nextGroupName: string) {
  ensureFirebase();

  const trimmedName = nextGroupName.trim();
  if (!trimmedName) {
    throw new Error("그룹 이름을 입력해 주세요.");
  }

  if (user.groupId !== group.id || group.ownerUserId !== user.id) {
    throw new Error("그룹 이름은 그룹 생성자만 바꿀 수 있어요.");
  }

  const groupRef = doc(db!, "groups", group.id);
  const membersQuery = query(collection(db!, "users"), where("groupId", "==", group.id));
  const membersSnapshot = await getDocs(membersQuery);
  const batch = writeBatch(db!);

  batch.set(
    groupRef,
    {
      name: trimmedName,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  membersSnapshot.docs.forEach((memberDoc) => {
    batch.set(
      memberDoc.ref,
      {
        groupName: trimmedName,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

  await batch.commit();
}

export async function leaveCurrentGroup(
  user: AppUser,
  group: GroupSummary,
  nextOwnerUserId?: string | null,
) {
  ensureFirebase();

  const userRef = doc(db!, "users", user.id);
  const groupRef = doc(db!, "groups", group.id);
  const nextOwnerRef = nextOwnerUserId ? doc(db!, "users", nextOwnerUserId) : null;

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists() || !groupSnap.exists()) {
      throw new Error("그룹 또는 사용자 정보를 찾지 못했어요.");
    }

    const userData = userSnap.data() as FirestoreUser;
    const groupData = groupSnap.data() as FirestoreGroup;

    if (userData.groupId !== group.id) {
      throw new Error("현재 속한 그룹 정보가 달라서 나가기를 진행할 수 없어요.");
    }

    const memberProfiles = resolveMemberProfiles(groupData);
    const ownerTransferRequired = groupData.ownerUserId === user.id && groupData.memberCount > 1;

    if (ownerTransferRequired && !nextOwnerUserId) {
      throw new Error("다음 그룹 오너를 먼저 선택해 주세요.");
    }

    if (nextOwnerUserId) {
      const nextOwnerExists = memberProfiles.some(
        (memberProfile) => memberProfile.userId === nextOwnerUserId && memberProfile.userId !== user.id,
      );

      if (!nextOwnerExists) {
        throw new Error("선택한 멤버를 다음 오너로 확인하지 못했어요.");
      }
    }

    if (groupData.memberCount <= 1) {
      transaction.delete(groupRef);
    } else {
      transaction.set(
        groupRef,
        {
          memberCount: Math.max(0, groupData.memberCount - 1),
          memberNames: removeOneMemberName(groupData.memberNames ?? [], user.displayName),
          memberProfiles: removeOneMemberProfile(groupData.memberProfiles ?? [], user.id, user.displayName),
          prayerRequests: removePrayerRequest(groupData.prayerRequests ?? {}, user.id, user.displayName),
          ownerUserId: ownerTransferRequired ? nextOwnerUserId : groupData.ownerUserId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (ownerTransferRequired && nextOwnerRef && nextOwnerUserId) {
      transaction.set(
        nextOwnerRef,
        {
          role: "owner",
          groupName: groupData.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    transaction.set(
      userRef,
      {
        groupId: null,
        groupName: null,
        role: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function updateGroupSubscriptionTier(
  user: AppUser,
  group: GroupSummary,
  nextTier: GroupSubscriptionTier,
) {
  ensureFirebase();

  const userRef = doc(db!, "users", user.id);
  const groupRef = doc(db!, "groups", group.id);

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists() || !groupSnap.exists()) {
      throw new Error("그룹 또는 사용자 정보를 찾지 못했어요.");
    }

    const userData = userSnap.data() as FirestoreUser;
    const groupData = groupSnap.data() as FirestoreGroup;

    if (userData.groupId !== group.id || groupData.ownerUserId !== user.id) {
      throw new Error("구독 플랜 변경은 그룹 오너만 할 수 있어요.");
    }

    const nextMaxMembers = nextTier === "growth" ? GROWTH_GROUP_MEMBER_LIMIT : FREE_GROUP_MEMBER_LIMIT;
    const safeMemberCount = Math.max(groupData.memberCount ?? 0, (groupData.memberNames ?? []).length);

    if (nextTier === "free" && safeMemberCount > FREE_GROUP_MEMBER_LIMIT) {
      throw new Error("현재 멤버가 7명을 넘어서 먼저 정리한 뒤 무료 플랜으로 돌아갈 수 있어요.");
    }

    transaction.set(
      groupRef,
      {
        subscriptionTier: nextTier,
        maxMembers: nextMaxMembers,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function deleteUserAccountData(
  user: AppUser,
  group: GroupSummary | null,
  nextOwnerUserId?: string | null,
) {
  ensureFirebase();

  const userRef = doc(db!, "users", user.id);

  if (!group || !user.groupId) {
    await deleteDoc(userRef);
    return;
  }

  const groupRef = doc(db!, "groups", group.id);
  const nextOwnerRef = nextOwnerUserId ? doc(db!, "users", nextOwnerUserId) : null;

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists()) {
      throw new Error("사용자 정보를 찾지 못했어요.");
    }

    if (!groupSnap.exists()) {
      transaction.delete(userRef);
      return;
    }

    const userData = userSnap.data() as FirestoreUser;
    const groupData = groupSnap.data() as FirestoreGroup;

    if (userData.groupId !== group.id) {
      transaction.delete(userRef);
      return;
    }

    const memberProfiles = resolveMemberProfiles(groupData);
    const ownerTransferRequired = groupData.ownerUserId === user.id && groupData.memberCount > 1;

    if (ownerTransferRequired && !nextOwnerUserId) {
      throw new Error("다음 그룹 오너를 먼저 선택해 주세요.");
    }

    if (nextOwnerUserId) {
      const nextOwnerExists = memberProfiles.some(
        (memberProfile) => memberProfile.userId === nextOwnerUserId && memberProfile.userId !== user.id,
      );

      if (!nextOwnerExists) {
        throw new Error("선택한 멤버를 다음 오너로 확인하지 못했어요.");
      }
    }

    if (groupData.memberCount <= 1) {
      transaction.delete(groupRef);
    } else {
      transaction.set(
        groupRef,
        {
          memberCount: Math.max(0, groupData.memberCount - 1),
          memberNames: removeOneMemberName(groupData.memberNames ?? [], user.displayName),
          memberProfiles: removeOneMemberProfile(groupData.memberProfiles ?? [], user.id, user.displayName),
          prayerRequests: removePrayerRequest(groupData.prayerRequests ?? {}, user.id, user.displayName),
          ownerUserId: ownerTransferRequired ? nextOwnerUserId : groupData.ownerUserId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (ownerTransferRequired && nextOwnerRef && nextOwnerUserId) {
      transaction.set(
        nextOwnerRef,
        {
          role: "owner",
          groupName: groupData.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    transaction.delete(userRef);
  });
}

export async function upsertGroupPrayerRequest(
  user: AppUser,
  group: GroupSummary,
  content: string,
  targetDateKey: string,
) {
  ensureFirebase();

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    throw new Error("중보기도 내용을 적어 주세요.");
  }

  if (!targetDateKey.trim()) {
    throw new Error("기도 순번 날짜를 확인하지 못했어요.");
  }

  const userRef = doc(db!, "users", user.id);
  const groupRef = doc(db!, "groups", group.id);

  await runTransaction(db!, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const groupSnap = await transaction.get(groupRef);

    if (!userSnap.exists() || !groupSnap.exists()) {
      throw new Error("그룹 또는 사용자 정보를 찾지 못했어요.");
    }

    const userData = userSnap.data() as FirestoreUser;
    const groupData = groupSnap.data() as FirestoreGroup;
    const nextPrayerRequests = {
      ...(groupData.prayerRequests ?? {}),
      [user.id]: {
        content: trimmedContent,
        targetDateKey,
        updatedAtMs: Date.now(),
        memberUserId: user.id,
        memberName: user.displayName,
      },
    };

    if (userData.groupId !== group.id) {
      throw new Error("현재 속한 공동체가 달라서 기도 내용을 저장할 수 없어요.");
    }

    if (user.displayName !== user.id) {
      delete nextPrayerRequests[user.displayName];
    }

    transaction.set(
      groupRef,
      {
        prayerRequests: nextPrayerRequests,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

function mapUser(id: string, data: FirestoreUser): AppUser {
  return {
    id,
    provider: data.provider,
    providerUserId: data.providerUserId,
    displayName: data.displayName,
    email: data.email ?? null,
    groupId: data.groupId ?? null,
    groupName: data.groupName ?? null,
    role: data.role ?? null,
    notificationSettings: withDefaultNotificationSettings(data.notificationSettings),
    pushTokens: data.pushTokens ?? [],
    blockedUserIds: data.blockedUserIds ?? [],
    legalConsentVersion: data.legalConsentVersion ?? null,
    legalConsentAcceptedAtMs: data.legalConsentAcceptedAtMs ?? null,
  };
}

function mapGroup(id: string, data: FirestoreGroup): GroupSummary {
  const subscriptionTier = data.subscriptionTier ?? "free";
  const memberProfiles = resolveMemberProfiles(data);

  return {
    id,
    name: data.name,
    inviteCode: data.inviteCode,
    memberCount: data.memberCount,
    maxMembers: resolveGroupMaxMembers(data),
    subscriptionTier,
    ownerUserId: data.ownerUserId,
    memberNames: memberProfiles.map((member) => member.displayName),
    memberProfiles,
    prayerRequests: data.prayerRequests ?? {},
  };
}

function resolveGroupMaxMembers(group: Pick<FirestoreGroup, "maxMembers" | "subscriptionTier">) {
  if (group.subscriptionTier === "growth") {
    return Math.max(group.maxMembers ?? 0, GROWTH_GROUP_MEMBER_LIMIT);
  }

  return FREE_GROUP_MEMBER_LIMIT;
}

function ensureFirebase() {
  if (!isFirebaseConfigured || !db) {
    throw new Error("Firebase 연결이 아직 준비되지 않았어요.");
  }
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function removeOneMemberName(memberNames: string[], targetName: string) {
  const nextNames = [...memberNames];
  const targetIndex = nextNames.indexOf(targetName);

  if (targetIndex >= 0) {
    nextNames.splice(targetIndex, 1);
  }

  return nextNames;
}

function replaceOneMemberName(memberNames: string[], fromName: string, toName: string) {
  const nextNames = [...memberNames];
  const targetIndex = nextNames.indexOf(fromName);

  if (targetIndex >= 0) {
    nextNames[targetIndex] = toName;
  }

  return nextNames;
}

function replaceOneMemberProfile(
  memberProfiles: GroupMemberProfile[],
  userId: string,
  fromName: string,
  toName: string,
) {
  const nextProfiles = memberProfiles.map((memberProfile) =>
    memberProfile.userId === userId || (!memberProfile.userId && memberProfile.displayName === fromName)
      ? {
          ...memberProfile,
          userId: memberProfile.userId ?? userId,
          displayName: toName,
        }
      : memberProfile,
  );

  if (nextProfiles.some((memberProfile) => memberProfile.userId === userId)) {
    return nextProfiles;
  }

  return [...nextProfiles, { userId, displayName: toName }];
}

function migratePrayerRequestOwner(
  prayerRequests: Record<string, GroupPrayerRequest>,
  userId: string,
  fromName: string,
  toName: string,
) {
  const nextPrayerRequests = { ...prayerRequests };
  const currentEntry = nextPrayerRequests[userId] ?? nextPrayerRequests[fromName];

  if (!currentEntry) {
    return nextPrayerRequests;
  }

  nextPrayerRequests[userId] = {
    ...currentEntry,
    memberUserId: userId,
    memberName: toName,
  };

  if (fromName !== userId) {
    delete nextPrayerRequests[fromName];
  }

  return nextPrayerRequests;
}

function removePrayerRequest(
  prayerRequests: Record<string, GroupPrayerRequest>,
  userId: string,
  displayName: string,
) {
  const nextPrayerRequests = { ...prayerRequests };
  delete nextPrayerRequests[userId];
  delete nextPrayerRequests[displayName];
  return nextPrayerRequests;
}

function removeOneMemberProfile(
  memberProfiles: GroupMemberProfile[],
  userId: string,
  displayName: string,
) {
  return memberProfiles.filter(
    (memberProfile) =>
      memberProfile.userId !== userId &&
      !(memberProfile.userId == null && memberProfile.displayName === displayName),
  );
}

function resolveMemberProfiles(group: FirestoreGroup): GroupMemberProfile[] {
  if (Array.isArray(group.memberProfiles) && group.memberProfiles.length > 0) {
    return group.memberProfiles
      .map((memberProfile) => ({
        userId: memberProfile.userId,
        displayName: normalizeStoredDisplayName(memberProfile.displayName, memberProfile.userId),
      }))
      .filter((memberProfile) => memberProfile.displayName);
  }

  return (group.memberNames ?? [])
    .map((memberName) => memberName.trim())
    .filter(Boolean)
    .map((memberName) => ({
      displayName: normalizeStoredDisplayName(memberName),
    }));
}

function shouldKeepExistingDisplayName(existingName?: string | null, nextName?: string | null) {
  if (!existingName) {
    return false;
  }

  const existingTrimmed = existingName.trim();
  const nextTrimmed = nextName?.trim() ?? "";
  if (!isPlaceholderDisplayName(nextTrimmed)) {
    return false;
  }

  return !isPlaceholderDisplayName(existingTrimmed);
}

function isPlaceholderDisplayName(displayName?: string | null) {
  const trimmed = displayName?.trim() ?? "";
  return (
    trimmed.length === 0 ||
    trimmed === "Apple 사용자" ||
    trimmed === "오늘은혜 사용자" ||
    trimmed.includes("@") ||
    /^은혜#[A-Za-z0-9]{4,}$/.test(trimmed)
  );
}

function normalizeStoredDisplayName(displayName?: string | null, userId?: string | null) {
  const trimmed = displayName?.trim() ?? "";
  if (!trimmed) {
    return userId ? buildGraceFallbackDisplayName(userId) : "";
  }

  if (trimmed === "Apple 사용자" || trimmed === "오늘은혜 사용자" || trimmed.includes("@")) {
    return buildGraceFallbackDisplayName(userId ?? trimmed);
  }

  return trimmed;
}

function buildGraceFallbackDisplayName(source?: string | null) {
  const normalizedSource = (source ?? "").trim();
  const numericTail = normalizedSource.replace(/\D/g, "").slice(-4);
  const alphaNumericTail = normalizedSource.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  const suffix = (numericTail || alphaNumericTail || "0001").padStart(4, "0");
  return `은혜#${suffix}`;
}
