const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();

const kakaoRestApiKey = defineSecret("KAKAO_REST_API_KEY");
const kakaoClientSecret = defineSecret("KAKAO_CLIENT_SECRET");

const KAKAO_REDIRECT_URI = "https://todaygrace-juan.web.app/kakao-bridge.html";
const APPLE_AUDIENCES = ["com.graceonecut.app", "host.exp.Exponent"];
const PRAYER_SCHEDULE_TIME_ZONE = "Asia/Seoul";
const PRAYER_ANCHOR_DAY_NUMBER = Math.floor(Date.UTC(2026, 0, 1) / (24 * 60 * 60 * 1000));

exports.exchangeKakaoCode = onCall(
  {
    region: "us-central1",
    invoker: "public",
    secrets: [kakaoRestApiKey, kakaoClientSecret],
  },
  async (request) => {
    const code = request.data?.code;

    if (!code || typeof code !== "string") {
      throw new HttpsError("invalid-argument", "Kakao 인가 코드가 필요해요.");
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: kakaoRestApiKey.value(),
      client_secret: kakaoClientSecret.value(),
      redirect_uri: KAKAO_REDIRECT_URI,
      code,
    });

    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: tokenBody.toString(),
    });
    const tokenJson = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenJson.access_token) {
      console.error("Kakao token exchange failed", {
        status: tokenResponse.status,
        body: tokenJson,
      });
      throw new HttpsError(
        "unauthenticated",
        tokenJson.error_description || "Kakao 토큰 교환에 실패했어요.",
      );
    }

    const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });
    const profileJson = await profileResponse.json();

    if (!profileResponse.ok || !profileJson.id) {
      console.error("Kakao profile fetch failed", {
        status: profileResponse.status,
        body: profileJson,
      });
      throw new HttpsError("unauthenticated", "Kakao 사용자 정보를 확인하지 못했어요.");
    }

    const uid = `kakao:${profileJson.id}`;
    const customToken = await admin.auth().createCustomToken(uid, {
      provider: "kakao",
    });

    return {
      customToken,
      identity: {
        provider: "kakao",
        providerUserId: String(profileJson.id),
        displayName:
          profileJson.properties?.nickname ||
          profileJson.kakao_account?.profile?.nickname ||
          "Kakao 사용자",
        email: profileJson.kakao_account?.email ?? null,
      },
    };
  },
);

exports.exchangeAppleIdentityToken = onCall(
  {
    region: "us-central1",
    invoker: "public",
  },
  async (request) => {
    const identityToken = request.data?.identityToken;
    const displayName = request.data?.displayName;
    const emailHint = request.data?.email;

    if (!identityToken || typeof identityToken !== "string") {
      throw new HttpsError("invalid-argument", "Apple identity token이 필요해요.");
    }

    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
    const { payload } = await jwtVerify(identityToken, appleJwks, {
      issuer: "https://appleid.apple.com",
      audience: APPLE_AUDIENCES,
    });

    if (!payload.sub || typeof payload.sub !== "string") {
      throw new HttpsError("unauthenticated", "Apple 사용자 식별값을 확인하지 못했어요.");
    }

    const uid = `apple:${payload.sub}`;
    const customToken = await admin.auth().createCustomToken(uid, {
      provider: "apple",
    });

    return {
      customToken,
      identity: {
        provider: "apple",
        providerUserId: payload.sub,
        displayName: sanitizeDisplayName(displayName) || buildAppleFallbackDisplayName(payload.sub),
        email: typeof payload.email === "string" ? payload.email : emailHint || null,
      },
    };
  },
);

exports.notifyGroupPostCreated = onDocumentCreated(
  {
    region: "us-central1",
    document: "gracePosts/{postId}",
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      return;
    }

    const post = snapshot.data();
    if (!post?.groupId || !post?.authorId || !post?.authorName) {
      return;
    }

    const usersSnapshot = await admin
      .firestore()
      .collection("users")
      .where("groupId", "==", post.groupId)
      .get();

    const targetTokens = new Set();

    usersSnapshot.forEach((userDoc) => {
      if (userDoc.id === post.authorId) {
        return;
      }

      const userData = userDoc.data();
      const groupPostEnabled = userData.notificationSettings?.groupPostEnabled === true;

      if (!groupPostEnabled || !Array.isArray(userData.pushTokens)) {
        return;
      }

      userData.pushTokens.forEach((token) => {
        if (isExpoPushToken(token)) {
          targetTokens.add(token);
        }
      });
    });

    if (targetTokens.size === 0) {
      return;
    }

    const messages = Array.from(targetTokens).map((token) => ({
      to: token,
      sound: "default",
      title: "오늘 은혜",
      body: `${post.authorName}님이 오늘의 은혜를 공유했습니다.`,
      data: {
        type: "group-post",
        postId: snapshot.id,
        groupId: post.groupId,
      },
    }));

    await sendExpoPushMessages(messages);
  },
);

exports.sendPrayerFlowNotifications = onSchedule(
  {
    region: "us-central1",
    schedule: "0 10 * * *",
    timeZone: PRAYER_SCHEDULE_TIME_ZONE,
  },
  async () => {
    const groupsSnapshot = await admin.firestore().collection("groups").get();

    if (groupsSnapshot.empty) {
      return;
    }

    const messages = [];
    const todayDayNumber = getPrayerDayNumberInTimeZone(new Date());

    for (const groupDoc of groupsSnapshot.docs) {
      const groupData = groupDoc.data();
      const usersSnapshot = await admin
        .firestore()
        .collection("users")
        .where("groupId", "==", groupDoc.id)
        .get();

      const users = usersSnapshot.docs.map((userDoc) => ({
        id: userDoc.id,
        ...userDoc.data(),
      }));
      const memberProfiles = resolvePrayerMemberProfiles(groupData, users);

      if (memberProfiles.length <= 1) {
        continue;
      }

      const cycle = buildPrayerCycle(groupDoc.id, memberProfiles, todayDayNumber);

      const nextPrayerRequest = readPrayerRequestForDate(
        groupData.prayerRequests,
        cycle.nextMember,
        cycle.nextDateKey,
      );

      if (!hasPrayerRequestContent(nextPrayerRequest)) {
        const nextMemberTokens = collectTokensForMember(users, cycle.nextMember);

        nextMemberTokens.forEach((token) => {
          messages.push({
            to: token,
            sound: "default",
            title: "내일 기도 순번이에요",
            body: `${groupData.name || "공동체"}가 함께 기도할 제목을 오늘 미리 남겨보세요.`,
            data: {
              type: "prayer-request-reminder",
              groupId: groupDoc.id,
              memberName: cycle.nextMemberName,
              memberUserId: cycle.nextMemberUserId || "",
              targetDateKey: cycle.nextDateKey,
            },
          });
        });
      }

      const todayPrayerRequest = readPrayerRequestForDate(
        groupData.prayerRequests,
        cycle.todayMember,
        cycle.todayDateKey,
      );

      if (!hasPrayerRequestContent(todayPrayerRequest)) {
        continue;
      }

      const prayerPreview = buildPrayerPreview(todayPrayerRequest.content);
      const recipientTokens = collectTokensForOtherMembers(users, cycle.todayMember);

      recipientTokens.forEach((token) => {
        messages.push({
          to: token,
          sound: "default",
          title: `${cycle.todayMemberName}님을 위해 함께 기도해요`,
          body: prayerPreview
            ? `오늘의 기도제목: ${prayerPreview}`
            : "오늘 남겨진 중보기도 제목을 확인하고 함께 기도해 주세요.",
            data: {
              type: "prayer-request-day",
              groupId: groupDoc.id,
              memberName: cycle.todayMemberName,
              memberUserId: cycle.todayMemberUserId || "",
              targetDateKey: cycle.todayDateKey,
            },
          });
        });
    }

    if (messages.length === 0) {
      return;
    }

    await sendExpoPushMessages(messages);
  },
);

function sanitizeDisplayName(displayName) {
  if (!displayName || typeof displayName !== "string") {
    return null;
  }

  const trimmed = displayName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAppleFallbackDisplayName(appleUserId) {
  const source = typeof appleUserId === "string" ? appleUserId.trim() : "";
  const numericTail = source.replace(/\D/g, "").slice(-4);
  const alphaNumericTail = source.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  const suffix = (numericTail || alphaNumericTail || "0001").padStart(4, "0");
  return `은혜#${suffix}`;
}

function isExpoPushToken(token) {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  );
}

async function sendExpoPushMessages(messages) {
  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      console.error("Expo push send failed", response.status, responseText);
    }
  }
}

function sanitizeMemberNames(memberNames) {
  if (!Array.isArray(memberNames)) {
    return [];
  }

  return memberNames
    .map((memberName) => sanitizeDisplayName(memberName))
    .filter(Boolean);
}

function normalizeMemberProfile(memberProfile) {
  if (!memberProfile || typeof memberProfile !== "object") {
    return null;
  }

  const displayName = sanitizeDisplayName(memberProfile.displayName);
  if (!displayName) {
    return null;
  }

  const userId =
    typeof memberProfile.userId === "string" && memberProfile.userId.trim()
      ? memberProfile.userId.trim()
      : undefined;

  return {
    userId,
    displayName,
  };
}

function dedupePrayerMemberProfiles(memberProfiles) {
  const seen = new Set();

  return memberProfiles.filter((memberProfile) => {
    const key = memberProfile.userId || `name:${memberProfile.displayName}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function resolvePrayerMemberProfiles(groupData, users) {
  const groupProfiles = Array.isArray(groupData.memberProfiles)
    ? groupData.memberProfiles.map(normalizeMemberProfile).filter(Boolean)
    : [];

  if (groupProfiles.length > 0) {
    return dedupePrayerMemberProfiles(groupProfiles);
  }

  const memberNames = sanitizeMemberNames(groupData.memberNames);

  return dedupePrayerMemberProfiles(
    memberNames.map((displayName) => {
      const matchedUsers = users.filter((user) => sanitizeDisplayName(user.displayName) === displayName);

      return {
        userId: matchedUsers.length === 1 ? matchedUsers[0].id : undefined,
        displayName,
      };
    }),
  );
}

function getPrayerDayNumberInTimeZone(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAYER_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return Math.floor(Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000));
}

function buildPrayerCycle(groupId, memberProfiles, todayDayNumber) {
  const cycleSize = memberProfiles.length;
  const elapsedDays = todayDayNumber - PRAYER_ANCHOR_DAY_NUMBER;
  const groupOffset = getPrayerGroupOffset(groupId, cycleSize);
  const todayIndex = ((elapsedDays + groupOffset) % cycleSize + cycleSize) % cycleSize;
  const todayMember = memberProfiles[todayIndex];
  const nextMember = memberProfiles[(todayIndex + 1) % cycleSize];

  return {
    cycleSize,
    todayIndex,
    todayMember,
    todayMemberName: todayMember.displayName,
    todayMemberUserId: todayMember.userId || null,
    todayDateKey: formatPrayerDateKeyFromDayNumber(todayDayNumber),
    nextMember,
    nextMemberName: nextMember.displayName,
    nextMemberUserId: nextMember.userId || null,
    nextDateKey: formatPrayerDateKeyFromDayNumber(todayDayNumber + 1),
  };
}

function getPrayerGroupOffset(groupId, cycleSize) {
  if (!cycleSize) {
    return 0;
  }

  return Array.from(groupId).reduce((sum, character) => sum + character.charCodeAt(0), 0) % cycleSize;
}

function formatPrayerDateKeyFromDayNumber(dayNumber) {
  const nextDate = new Date(dayNumber * 24 * 60 * 60 * 1000);
  const year = nextDate.getUTCFullYear();
  const month = `${nextDate.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${nextDate.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readPrayerRequestForDate(prayerRequests, memberProfile, targetDateKey) {
  if (!prayerRequests || typeof prayerRequests !== "object") {
    return null;
  }

  const prayerRequest =
    (memberProfile.userId ? prayerRequests[memberProfile.userId] : null) ??
    prayerRequests[memberProfile.displayName];

  if (!prayerRequest || prayerRequest.targetDateKey !== targetDateKey) {
    return null;
  }

  return prayerRequest;
}

function hasPrayerRequestContent(prayerRequest) {
  return Boolean(prayerRequest?.content && String(prayerRequest.content).trim());
}

function collectTokensForMember(users, memberProfile) {
  const tokens = new Set();

  users.forEach((user) => {
    const isTargetMember = memberProfile.userId
      ? user.id === memberProfile.userId
      : user.displayName === memberProfile.displayName;

    if (!isTargetMember) {
      return;
    }

    if (user.notificationSettings?.groupPostEnabled !== true || !Array.isArray(user.pushTokens)) {
      return;
    }

    user.pushTokens.forEach((token) => {
      if (isExpoPushToken(token)) {
        tokens.add(token);
      }
    });
  });

  return tokens;
}

function collectTokensForOtherMembers(users, excludedMemberProfile) {
  const tokens = new Set();

  users.forEach((user) => {
    const isExcludedMember = excludedMemberProfile.userId
      ? user.id === excludedMemberProfile.userId
      : user.displayName === excludedMemberProfile.displayName;

    if (isExcludedMember) {
      return;
    }

    if (user.notificationSettings?.groupPostEnabled !== true || !Array.isArray(user.pushTokens)) {
      return;
    }

    user.pushTokens.forEach((token) => {
      if (isExpoPushToken(token)) {
        tokens.add(token);
      }
    });
  });

  return tokens;
}

function buildPrayerPreview(content) {
  if (!content || typeof content !== "string") {
    return "";
  }

  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}
