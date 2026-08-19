import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { Image } from "expo-image";
import { FlipType, SaveFormat, manipulateAsync } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  acceptLegalConsents,
  blockUserProfile,
  createGroupForUser,
  deleteUserAccountData,
  joinGroupWithInviteCode,
  leaveCurrentGroup,
  regenerateInviteCode,
  registerExpoPushToken,
  renameUserDisplayName,
  renameGroupName,
  subscribeGroup,
  subscribeUserProfile,
  updateGroupSubscriptionTier,
  updateNotificationSettings,
  upsertGroupPrayerRequest,
  upsertSocialUser,
} from "@/src/features/grace-app/community";
import {
  deleteFirebaseAccountSession,
  signInWithAppleCustomToken,
  signInWithKakaoCustomToken,
  signOutFirebaseSession,
} from "@/src/features/grace-app/firebaseAuth";
import {
  createGracePost,
  deleteGracePost,
  purgeGracePostsByAuthor,
  subscribeGracePosts,
} from "@/src/features/grace-app/firebasePosts";
import { demoGroup, demoPostsByGroup, demoUserProfile } from "@/src/features/grace-app/firestoreData";
import { type GracePost } from "@/src/features/grace-app/mockData";
import {
  REMINDER_TIME_OPTIONS,
  formatReminderTime,
  getExpoPushTokenValue,
  requestNotificationPermission,
  syncDailyReminderNotification,
} from "@/src/features/grace-app/notifications";
import {
  LEGAL_CONSENT_VERSION,
  legalDocuments,
  legalDocumentLinks,
  requiredConsentItems,
  type LegalDocumentId,
} from "@/src/features/grace-app/legal";
import {
  getScriptureKey,
  pickScriptureAvoiding,
  scripturePool,
  type ScriptureCard,
} from "@/src/features/grace-app/scripturePool";
import {
  defaultGroupUpgradeState,
  isPurchaseCancelledError,
  loadGroupUpgradeState,
  purchaseGrowthPlan,
  resetRevenueCatSession,
  restoreGrowthPlan,
  type GroupUpgradeState,
} from "@/src/features/grace-app/revenuecat";
import {
  isAppleLoginAvailable,
  signInWithApple,
  signInWithKakao,
} from "@/src/features/grace-app/socialAuth";
import { clearStoredSession, loadStoredSessionUserId, persistSessionUserId } from "@/src/features/grace-app/session";
import { theme } from "@/src/features/grace-app/theme";
import {
  defaultNotificationSettings,
  type AppUser,
  type GroupSummary,
  type NotificationSettings,
} from "@/src/features/grace-app/types";
import { auth, isFirebaseConfigured } from "@/src/lib/firebase";

type TabKey = "home" | "upload" | "mine";

type DraftState = {
  imageUri?: string;
  scripture?: ScriptureCard;
  caption: string;
};

type PendingUploadPost = GracePost & {
  isUploading: true;
};

const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "홈", icon: "home-outline" },
  { key: "upload", label: "업로드", icon: "add-circle-outline" },
  { key: "mine", label: "공동체", icon: "people-outline" },
];

const REVEAL_HINT_STORAGE_KEY = "today_grace_reveal_hint_seen_v1";
const APPLE_STANDARD_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

function getUpgradeServicePeriodLabel(periodLabel: string | null | undefined) {
  switch (periodLabel) {
    case "월간 구독":
      return "1개월";
    case "연간 구독":
      return "12개월";
    case "6개월 구독":
      return "6개월";
    case "3개월 구독":
      return "3개월";
    case "주간 구독":
      return "1주";
    default:
      return periodLabel ?? "구독 기간";
  }
}

function getUpgradeServiceDescription(periodLabel: string | null | undefined) {
  switch (periodLabel) {
    case "월간 구독":
      return "매 구독 기간 동안 공동체 최대 인원이 20명으로 확장됩니다.";
    case "연간 구독":
      return "연간 구독 기간 동안 공동체 최대 인원이 20명으로 확장됩니다.";
    default:
      return "활성 구독 기간 동안 공동체 최대 인원이 20명으로 확장됩니다.";
  }
}

export default function Index() {
  const [booting, setBooting] = useState(true);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [authBusy, setAuthBusy] = useState<"apple" | "kakao" | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [currentGroup, setCurrentGroup] = useState<GroupSummary | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [posts, setPosts] = useState<GracePost[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUploadPost[]>([]);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [revealHintVisible, setRevealHintVisible] = useState(false);
  const [verseCollectionVisible, setVerseCollectionVisible] = useState(false);
  const [groupBusy, setGroupBusy] = useState<"create" | "join" | "regen" | "leave" | "rename" | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [communityPanel, setCommunityPanel] = useState<"community" | "settings">("community");
  const [notificationBusy, setNotificationBusy] = useState<"daily" | "group-post" | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [displayNameBusy, setDisplayNameBusy] = useState(false);
  const [ownerTransferMode, setOwnerTransferMode] = useState<"leave" | "delete" | null>(null);
  const [ownerTransferTargetUserId, setOwnerTransferTargetUserId] = useState<string | null>(null);
  const [legalConsentDraft, setLegalConsentDraft] = useState({
    terms: false,
    privacy: false,
    community: false,
  });
  const [legalConsentSaving, setLegalConsentSaving] = useState(false);
  const [legalInfoPageVisible, setLegalInfoPageVisible] = useState(false);
  const [legalInfoInitialDocumentId, setLegalInfoInitialDocumentId] = useState<LegalDocumentId | null>(null);
  const [upgradeRefreshing, setUpgradeRefreshing] = useState(false);
  const [upgradeActionBusy, setUpgradeActionBusy] = useState<"purchase" | "restore" | null>(null);
  const [groupUpgradeState, setGroupUpgradeState] = useState<GroupUpgradeState>(defaultGroupUpgradeState);
  const [reminderPromptVisible, setReminderPromptVisible] = useState(false);
  const [reminderDraft, setReminderDraft] = useState({
    hour: defaultNotificationSettings.reminderHour,
    minute: defaultNotificationSettings.reminderMinute,
  });
  const [prayerRequestPromptVisible, setPrayerRequestPromptVisible] = useState(false);
  const [prayerRequestDraft, setPrayerRequestDraft] = useState("");
  const [prayerRequestBusy, setPrayerRequestBusy] = useState(false);
  const [prayerPromptDeferredDateKey, setPrayerPromptDeferredDateKey] = useState<string | null>(null);
  const [prayerRequestEditorState, setPrayerRequestEditorState] = useState<{
    targetDateKey: string;
    title: string;
    description: string;
  } | null>(null);
  const [draft, setDraft] = useState<DraftState>({
    caption: "",
  });
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraType>("back");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [libraryPickerBusy, setLibraryPickerBusy] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const recentScriptureKeysRef = useRef<string[]>([]);
  const legacyDisplayNameSyncRef = useRef<string | null>(null);
  const prayerPromptState = useMemo(
    () => (currentUser && currentGroup ? buildPrayerRequestPrompt(currentGroup, currentUser) : null),
    [currentGroup, currentUser],
  );
  const legalConsentReady = useMemo(
    () => requiredConsentItems.every((item) => legalConsentDraft[item.id]),
    [legalConsentDraft],
  );

  const visiblePosts = useMemo(
    () =>
      posts.filter(
        (post) => !(post.authorId && currentUser?.blockedUserIds.includes(post.authorId)),
      ),
    [currentUser?.blockedUserIds, posts],
  );
  const myPosts = useMemo(
    () => posts.filter((post) => post.authorId === currentUser?.id),
    [currentUser?.id, posts],
  );
  const homePosts = useMemo(() => [...pendingUploads, ...visiblePosts], [pendingUploads, visiblePosts]);
  const ownerTransferCandidates = useMemo(
    () =>
      currentGroup && currentUser
        ? currentGroup.memberProfiles.filter(
            (memberProfile) => Boolean(memberProfile.userId) && memberProfile.userId !== currentUser.id,
          )
        : [],
    [currentGroup, currentUser],
  );
  const currentMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
      }).format(new Date()),
    [],
  );
  const legalConsentRequired = useMemo(
    () =>
      currentUser
        ? currentUser.legalConsentVersion !== LEGAL_CONSENT_VERSION || !currentUser.legalConsentAcceptedAtMs
        : false,
    [currentUser],
  );
  const verseCollection = useMemo(() => {
    const seen = new Set<string>();
    const now = new Date();

    return visiblePosts.reduce<
      {
        id: string;
        text: string;
        reference?: string;
        authorName: string;
        createdLabel: string;
      }[]
    >((items, post) => {
      if (!post.verseText) {
        return items;
      }

      if (post.createdAtMs) {
        const createdDate = new Date(post.createdAtMs);
        const isCurrentMonth =
          createdDate.getFullYear() === now.getFullYear() &&
          createdDate.getMonth() === now.getMonth();

        if (!isCurrentMonth) {
          return items;
        }
      }

      const key = `${post.verseText}__${post.verseReference ?? ""}`;
      if (seen.has(key)) {
        return items;
      }

      seen.add(key);
      items.push({
        id: key,
        text: post.verseText,
        reference: post.verseReference,
        authorName: post.authorName,
        createdLabel: post.createdLabel,
      });

      return items;
    }, []);
  }, [visiblePosts]);
  const headerAnimation = useMemo(() => new Animated.Value(0), []);
  const animatedHeaderHeight = useMemo(
    () =>
      headerAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [88, 0],
      }),
    [headerAnimation],
  );
  const animatedHeaderOpacity = useMemo(
    () =>
      headerAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    [headerAnimation],
  );
  const animatedHeaderMargin = useMemo(
    () =>
      headerAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [theme.spacing.lg, 0],
      }),
    [headerAnimation],
  );

  useEffect(() => {
    isAppleLoginAvailable()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(REVEAL_HINT_STORAGE_KEY)
      .then((value) => {
        if (!active) {
          return;
        }

        setRevealHintVisible(value !== "1");
      })
      .catch(() => {
        if (active) {
          setRevealHintVisible(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(headerAnimation, {
      toValue: headerCollapsed ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [headerAnimation, headerCollapsed]);

  useEffect(() => {
    setHeaderCollapsed(false);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "mine") {
      setCommunityPanel("community");
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setCurrentUser(demoUserProfile);
      setCurrentGroup(demoGroup);
      setPosts(demoPostsByGroup);
      setBooting(false);
      return;
    }

    loadStoredSessionUserId()
      .then(async (storedUserId) => {
        if (!storedUserId) {
          setBooting(false);
          return;
        }

        const currentFirebaseUid = auth?.currentUser?.uid ?? null;
        if (!currentFirebaseUid || currentFirebaseUid !== storedUserId) {
          await clearStoredSession();
          setSessionUserId(null);
          setBooting(false);
          return;
        }

        setSessionUserId(storedUserId);
        setBooting(false);
      })
      .catch((error: Error) => {
        setBooting(false);
        Alert.alert("세션 로드 실패", error.message);
      });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !sessionUserId) {
      setCurrentUser(null);
      return;
    }

    const unsubscribe = subscribeUserProfile(
      sessionUserId,
      (nextUser) => {
        setCurrentUser(nextUser);
      },
      (error) => {
        Alert.alert("프로필 동기화 실패", error.message);
      },
    );

    return unsubscribe;
  }, [sessionUserId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !currentUser?.groupId) {
      setCurrentGroup(null);
      setPosts([]);
      return;
    }

    const unsubscribe = subscribeGroup(
      currentUser.groupId,
      (nextGroup) => setCurrentGroup(nextGroup),
      (error) => Alert.alert("그룹 동기화 실패", error.message),
    );

    return unsubscribe;
  }, [currentUser?.groupId]);

  useEffect(() => {
    if (!currentUser?.groupId) {
      return;
    }

    setFeedLoading(true);
    setFeedError(null);

    const unsubscribe = subscribeGracePosts(
      currentUser.groupId,
      (nextPosts) => {
        setPosts(nextPosts);
        setFeedLoading(false);
      },
      (error) => {
        setFeedError(error.message);
        setFeedLoading(false);
      },
    );

    return unsubscribe;
  }, [currentUser?.groupId]);

  useEffect(() => {
    let cancelled = false;

    if (!currentUser || !currentGroup || !isFirebaseConfigured) {
      setGroupUpgradeState(defaultGroupUpgradeState);
      setUpgradeRefreshing(false);
      return () => {
        cancelled = true;
      };
    }

    if (currentUser.role !== "owner") {
      setGroupUpgradeState({
        ...defaultGroupUpgradeState,
        configured: true,
        message: "공동체 확장 플랜은 그룹 오너가 결제할 수 있어요.",
      });
      setUpgradeRefreshing(false);
      return () => {
        cancelled = true;
      };
    }

    setUpgradeRefreshing(true);

    void loadGroupUpgradeState(currentUser.id)
      .then(async (nextState) => {
        if (cancelled) {
          return;
        }

        setGroupUpgradeState(nextState);

        if (nextState.entitlementActive && currentGroup.subscriptionTier !== "growth") {
          await updateGroupSubscriptionTier(currentUser, currentGroup, "growth").catch(() => undefined);
          return;
        }

        if (
          !nextState.entitlementActive &&
          currentGroup.subscriptionTier === "growth" &&
          currentGroup.memberCount <= 7
        ) {
          await updateGroupSubscriptionTier(currentUser, currentGroup, "free").catch(() => undefined);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setGroupUpgradeState({
            ...defaultGroupUpgradeState,
            configured: true,
            message: error.message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setUpgradeRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentGroup,
    currentGroup?.id,
    currentGroup?.memberCount,
    currentGroup?.subscriptionTier,
    currentUser,
    currentUser?.id,
    currentUser?.role,
  ]);

  useEffect(() => {
    if (!isFirebaseConfigured || !currentUser || !currentGroup) {
      setReminderPromptVisible(false);
      return;
    }

    if (authBusy) {
      return;
    }

    if (!currentUser.notificationSettings.reminderPromptSeen) {
      setReminderDraft({
        hour: currentUser.notificationSettings.reminderHour,
        minute: currentUser.notificationSettings.reminderMinute,
      });
      setReminderPromptVisible(true);
      return;
    }

    setReminderPromptVisible(false);
  }, [authBusy, currentGroup, currentUser]);

  useEffect(() => {
    if (!currentUser || !isFirebaseConfigured) {
      return;
    }

    void syncDailyReminderNotification(currentUser.notificationSettings).catch(() => {
      // Best effort only. Explicit toggles handle permission prompts.
    });
  }, [
    currentUser,
    currentUser?.id,
    currentUser?.notificationSettings.dailyReminderEnabled,
    currentUser?.notificationSettings.reminderHour,
    currentUser?.notificationSettings.reminderMinute,
  ]);

  useEffect(() => {
    if (!currentUser || !currentGroup) {
      setPrayerRequestPromptVisible(false);
      setPrayerRequestEditorState(null);
      setPrayerPromptDeferredDateKey(null);
      return;
    }

    if (authBusy || reminderPromptVisible) {
      return;
    }

    if (!prayerPromptState?.shouldPrompt) {
      setPrayerRequestPromptVisible(false);

      if (!prayerPromptState || prayerPromptDeferredDateKey !== prayerPromptState.targetDateKey) {
        setPrayerPromptDeferredDateKey(null);
      }

      return;
    }

    if (prayerPromptDeferredDateKey === prayerPromptState.targetDateKey) {
      return;
    }

    setPrayerRequestDraft(prayerPromptState.existingContent);
    setPrayerRequestEditorState({
      targetDateKey: prayerPromptState.targetDateKey,
      title: "내일 받을 중보기도를 적어 주세요",
      description: `내일은 ${currentUser.displayName} 님 차례예요. 공동체가 붙들고 기도할 내용을 한두 문장으로 남겨보세요.`,
    });
    setPrayerRequestPromptVisible(true);
  }, [
    authBusy,
    currentGroup,
    currentUser,
    prayerPromptDeferredDateKey,
    prayerPromptState,
    reminderPromptVisible,
  ]);

  useEffect(() => {
    if (!currentUser || currentUser.provider !== "apple") {
      legacyDisplayNameSyncRef.current = null;
      return;
    }

    if (!shouldNormalizeLegacyDisplayName(currentUser.displayName)) {
      legacyDisplayNameSyncRef.current = null;
      return;
    }

    if (legacyDisplayNameSyncRef.current === currentUser.id) {
      return;
    }

    const nextDisplayName = buildPreferredAppleDisplayName(currentUser.providerUserId || currentUser.id);
    legacyDisplayNameSyncRef.current = currentUser.id;

    void renameUserDisplayName(currentUser, nextDisplayName)
      .then(() => {
        setCurrentUser((previous) =>
          previous && previous.id === currentUser.id ? { ...previous, displayName: nextDisplayName } : previous,
        );
      })
      .catch(() => {
        legacyDisplayNameSyncRef.current = null;
      });
  }, [currentUser]);

  const resetLegalConsentDraft = () => {
    setLegalConsentDraft({
      terms: false,
      privacy: false,
      community: false,
    });
  };

  const closeOwnerTransferModal = () => {
    setOwnerTransferMode(null);
    setOwnerTransferTargetUserId(null);
  };

  const openOwnerTransferModal = (mode: "leave" | "delete") => {
    if (ownerTransferCandidates.length === 0 || !ownerTransferCandidates[0]?.userId) {
      Alert.alert("오너 위임 준비 필요", "다음 오너로 지정할 멤버 정보를 아직 확인하지 못했어요.");
      return;
    }

    setOwnerTransferTargetUserId(ownerTransferCandidates[0].userId);
    setOwnerTransferMode(mode);
  };

  const openLegalInfoPage = (documentId?: LegalDocumentId) => {
    setLegalInfoInitialDocumentId(documentId ?? null);
    setLegalInfoPageVisible(true);
  };

  const handleDismissLegalConsentPrompt = () => {
    Alert.alert("동의 후 시작해 주세요", "처음 가입할 때는 필수 문서 3개에 동의해야 서비스를 사용할 수 있어요.", [
      {
        text: "가입 취소",
        style: "destructive",
        onPress: async () => {
          try {
            if (currentUser) {
              await deleteUserAccountData(currentUser, currentGroup);
              await deleteFirebaseAccountSession();
            } else {
              await signOutFirebaseSession();
            }
          } finally {
            await clearStoredSession();
            setSessionUserId(null);
            setCurrentUser(null);
            setCurrentGroup(null);
            resetLegalConsentDraft();
          }
        },
      },
      {
        text: "계속 확인할게요",
        style: "cancel",
      },
    ]);
  };

  const handleAcceptLegalConsents = async () => {
    if (!currentUser) {
      return;
    }

    if (!legalConsentReady) {
      Alert.alert("필수 동의가 필요해요", "이용약관, 개인정보 정책, 커뮤니티 가이드라인을 모두 확인해 주세요.");
      return;
    }

    try {
      setLegalConsentSaving(true);
      const acceptedMeta = await acceptLegalConsents(currentUser.id);
      setCurrentUser((previous) =>
        previous
          ? {
              ...previous,
              legalConsentVersion: acceptedMeta.legalConsentVersion,
              legalConsentAcceptedAtMs: acceptedMeta.legalConsentAcceptedAtMs,
            }
          : previous,
      );
      resetLegalConsentDraft();
    } catch (error) {
      Alert.alert("동의 저장 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setLegalConsentSaving(false);
    }
  };

  const handleAppleLogin = async () => {
    try {
      setAuthBusy("apple");
      const appleResult = await signInWithApple();
      const identity = await signInWithAppleCustomToken(appleResult);
      const firebaseUid = auth?.currentUser?.uid;
      if (!firebaseUid) {
        throw new Error("Firebase 로그인 세션을 만들지 못했어요.");
      }
      const { user, needsLegalConsent } = await upsertSocialUser(firebaseUid, identity);
      await persistSessionUserId(user.id);
      setSessionUserId(user.id);
      setCurrentUser(user);
      if (needsLegalConsent || user.legalConsentVersion !== LEGAL_CONSENT_VERSION || !user.legalConsentAcceptedAtMs) {
        resetLegalConsentDraft();
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("canceled")) {
        return;
      }

      Alert.alert("Apple 로그인 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setAuthBusy(null);
    }
  };

  const handleKakaoLogin = async () => {
    try {
      setAuthBusy("kakao");
      const kakaoResult = await signInWithKakao();
      const identity = await signInWithKakaoCustomToken(kakaoResult.authorizationCode);
      const firebaseUid = auth?.currentUser?.uid;
      if (!firebaseUid) {
        throw new Error("Firebase 로그인 세션을 만들지 못했어요.");
      }
      const { user, needsLegalConsent } = await upsertSocialUser(firebaseUid, identity);
      await persistSessionUserId(user.id);
      setSessionUserId(user.id);
      setCurrentUser(user);
      if (needsLegalConsent || user.legalConsentVersion !== LEGAL_CONSENT_VERSION || !user.legalConsentAcceptedAtMs) {
        resetLegalConsentDraft();
      }
    } catch (error) {
      Alert.alert("Kakao 로그인 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setAuthBusy(null);
    }
  };

  const handleCreateGroup = async () => {
    if (!currentUser) {
      return;
    }

    try {
      setGroupBusy("create");
      await createGroupForUser(currentUser, groupNameInput);
      setGroupNameInput("");
    } catch (error) {
      Alert.alert("그룹 생성 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setGroupBusy(null);
    }
  };

  const handleJoinGroup = async () => {
    if (!currentUser) {
      return;
    }

    try {
      setGroupBusy("join");
      await joinGroupWithInviteCode(currentUser, inviteCodeInput);
      setInviteCodeInput("");
    } catch (error) {
      Alert.alert("그룹 참여 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setGroupBusy(null);
    }
  };

  const handleCopyInviteCode = async () => {
    if (!currentGroup) {
      return;
    }

    await Clipboard.setStringAsync(currentGroup.inviteCode);
    Alert.alert("초대 코드 복사 완료", `${currentGroup.inviteCode} 코드를 복사했어요.`);
  };

  const handleRegenerateInviteCode = async () => {
    if (!currentUser || !currentGroup) {
      return;
    }

    try {
      setGroupBusy("regen");
      await regenerateInviteCode(currentUser, currentGroup);
      Alert.alert("초대 코드 재생성 완료", "이전 코드는 닫히고, 새 초대 코드가 바로 적용됐어요.");
    } catch (error) {
      Alert.alert("초대 코드 재생성 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setGroupBusy(null);
    }
  };

  const handleRenameCurrentGroup = async (nextGroupName: string) => {
    if (!currentUser || !currentGroup) {
      return false;
    }

    try {
      setGroupBusy("rename");
      await renameGroupName(currentUser, currentGroup, nextGroupName);
      Alert.alert("그룹 이름 변경 완료", "공동체 이름을 새 이름으로 바꿨어요.");
      return true;
    } catch (error) {
      Alert.alert("그룹 이름 변경 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
      return false;
    } finally {
      setGroupBusy(null);
    }
  };

  const handleLeaveGroup = () => {
    if (!currentUser || !currentGroup) {
      return;
    }

    if (currentUser.role === "owner" && currentGroup.memberCount > 1) {
      openOwnerTransferModal("leave");
      return;
    }

    const leavingCopy =
      currentUser.role === "owner"
        ? "혼자 남아 있는 그룹이라 나가면 그룹도 함께 정리돼요."
        : "나가면 초대 코드가 있어야 다시 들어올 수 있어요.";

    Alert.alert("그룹에서 나갈까요?", leavingCopy, [
      { text: "취소", style: "cancel" },
      {
        text: "나가기",
        style: "destructive",
        onPress: () => {
          void performLeaveGroup();
        },
      },
    ]);
  };

  const performLeaveGroup = async (nextOwnerUserId?: string | null) => {
    if (!currentUser || !currentGroup) {
      return;
    }

    try {
      setGroupBusy("leave");
      await leaveCurrentGroup(currentUser, currentGroup, nextOwnerUserId);
      closeOwnerTransferModal();
      Alert.alert("그룹에서 나왔어요", "언제든 새 그룹을 만들거나 초대 코드로 다시 참여할 수 있어요.");
    } catch (error) {
      Alert.alert("그룹 나가기 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setGroupBusy(null);
    }
  };

  const handlePurchaseGrowthPlan = async () => {
    if (!currentUser || !currentGroup || upgradeActionBusy) {
      return false;
    }

    try {
      setUpgradeActionBusy("purchase");
      const result = await purchaseGrowthPlan(currentUser.id);
      setGroupUpgradeState(result.state);
      await updateGroupSubscriptionTier(currentUser, currentGroup, "growth").catch((error: Error) => {
        throw new Error(
          `결제는 완료됐지만 공동체 확장 반영에서 한 번 막혔어요. ${error.message}`,
        );
      });
      Alert.alert("확장 플랜 시작", "이제 최대 20명까지 함께할 수 있어요.");
      return true;
    } catch (error) {
      if (isPurchaseCancelledError(error)) {
        return false;
      }

      Alert.alert("구독 결제 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
      return false;
    } finally {
      setUpgradeActionBusy(null);
    }
  };

  const handleRestoreGrowthPlan = async () => {
    if (!currentUser || !currentGroup || upgradeActionBusy) {
      return false;
    }

    try {
      setUpgradeActionBusy("restore");
      const result = await restoreGrowthPlan(currentUser.id);
      setGroupUpgradeState(result.state);

      if (result.state.entitlementActive) {
        await updateGroupSubscriptionTier(currentUser, currentGroup, "growth").catch((error: Error) => {
          throw new Error(
            `구독은 복원됐지만 공동체 확장 반영이 한 번 막혔어요. ${error.message}`,
          );
        });
        Alert.alert("구독 복원 완료", "확장 플랜이 다시 연결됐어요.");
        return true;
      }

      Alert.alert("복원할 구독 없음", "이 계정에서 활성화된 확장 플랜을 찾지 못했어요.");
      return false;
    } catch (error) {
      Alert.alert("구독 복원 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
      return false;
    } finally {
      setUpgradeActionBusy(null);
    }
  };

  const resetAuthenticatedViewState = () => {
    setSessionUserId(null);
    setCurrentUser(null);
    setCurrentGroup(null);
    setPosts([]);
    setPendingUploads([]);
    setDeletingPostId(null);
    setAccountBusy(false);
    setOwnerTransferMode(null);
    setOwnerTransferTargetUserId(null);
    setActiveTab("home");
    setCommunityPanel("community");
    setReminderPromptVisible(false);
    setUpgradeRefreshing(false);
    setUpgradeActionBusy(null);
    setGroupUpgradeState(defaultGroupUpgradeState);
    setDraft({ caption: "" });
  };

  const handleSignOut = async () => {
    await resetRevenueCatSession().catch(() => undefined);
    await signOutFirebaseSession();
    await clearStoredSession();
    resetAuthenticatedViewState();
  };

  const performDeleteAccount = async (nextOwnerUserId?: string | null) => {
    if (!currentUser || accountBusy) {
      return;
    }

    try {
      setAccountBusy(true);
      await purgeGracePostsByAuthor(currentUser.id);
      await deleteUserAccountData(currentUser, currentGroup, nextOwnerUserId);
      closeOwnerTransferModal();
      await resetRevenueCatSession().catch(() => undefined);
      await deleteFirebaseAccountSession();
      await clearStoredSession();
      resetAuthenticatedViewState();
      Alert.alert("회원 탈퇴 완료", "계정과 업로드한 게시물을 정리했어요.");
    } catch (error) {
      Alert.alert("회원 탈퇴 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setAccountBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    if (!currentUser) {
      return;
    }

    if (currentUser.role === "owner" && currentGroup && currentGroup.memberCount > 1) {
      openOwnerTransferModal("delete");
      return;
    }

    Alert.alert("회원 탈퇴할까요?", "업로드한 게시물과 계정 정보가 함께 삭제되고 다시 복구할 수 없어요.", [
      { text: "취소", style: "cancel" },
      {
        text: "회원 탈퇴",
        style: "destructive",
        onPress: () => {
          void performDeleteAccount();
        },
      },
    ]);
  };

  const handleReportPost = async (post: GracePost) => {
    try {
      const subject = encodeURIComponent(`[오늘 은혜] 게시물 신고 - ${post.authorName}`);
      const body = encodeURIComponent(
        [
          "안녕하세요. 오늘 은혜 게시물을 신고합니다.",
          "",
          `작성자: ${post.authorName}`,
          `그룹: ${post.groupName}`,
          `게시물 ID: ${post.id}`,
          `등록 시각: ${post.createdLabel}`,
          `말씀: ${post.verseReference ?? "-"}`,
          `본문: ${post.caption}`,
          "",
          "신고 사유를 아래에 적어 주세요.",
        ].join("\n"),
      );
      const mailUrl = `mailto:iworkouttoday@gmail.com?subject=${subject}&body=${body}`;

      await Linking.openURL(mailUrl);
    } catch (error) {
      Alert.alert("메일 열기 실패", error instanceof Error ? error.message : "메일 앱을 열지 못했어요.");
    }
  };

  const handleBlockAuthor = async (post: GracePost) => {
    if (!currentUser || !post.authorId) {
      Alert.alert("차단할 수 없음", "작성자 정보를 아직 확인하지 못했어요.");
      return;
    }

    if (currentUser.blockedUserIds.includes(post.authorId)) {
      Alert.alert("이미 차단됨", `${post.authorName}님의 게시물은 이미 홈 피드에서 숨겨져 있어요.`);
      return;
    }

    try {
      await blockUserProfile(currentUser.id, post.authorId);
      Alert.alert("작성자 차단 완료", `${post.authorName}님의 게시물은 이제 홈 피드에서 보이지 않아요.`);
    } catch (error) {
      Alert.alert("차단 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    }
  };

  const handleOpenPostMenu = (post: GracePost) => {
    const isMyPost = post.authorId === currentUser?.id;

    if (isMyPost) {
      Alert.alert("게시물 메뉴", "내 게시물은 여기서 바로 삭제할 수 있어요.", [
        { text: "취소", style: "cancel" },
        {
          text: "삭제하기",
          style: "destructive",
          onPress: () => setDeletingPostId(post.id),
        },
      ]);
      return;
    }

    Alert.alert(`${post.authorName}님의 게시물`, "신고하거나 작성자를 차단할 수 있어요.", [
      { text: "취소", style: "cancel" },
      {
        text: "신고하기",
        style: "destructive",
        onPress: () => {
          void handleReportPost(post);
        },
      },
      {
        text: `${post.authorName}님 차단`,
        onPress: () => {
          void handleBlockAuthor(post);
        },
      },
    ]);
  };

  const updateReminderSettings = async (nextSettings: NotificationSettings) => {
    if (!currentUser) {
      return;
    }

    await updateNotificationSettings(currentUser.id, {
      dailyReminderEnabled: nextSettings.dailyReminderEnabled,
      reminderHour: nextSettings.reminderHour,
      reminderMinute: nextSettings.reminderMinute,
      reminderPromptSeen: nextSettings.reminderPromptSeen,
    });
  };

  const handleSkipReminderPrompt = async () => {
    if (!currentUser) {
      setReminderPromptVisible(false);
      return;
    }

    try {
      await updateReminderSettings({
        ...currentUser.notificationSettings,
        reminderPromptSeen: true,
      });
      setReminderPromptVisible(false);
    } catch (error) {
      Alert.alert("설정 저장 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    }
  };

  const handleDeferPrayerRequestPrompt = () => {
    setPrayerRequestPromptVisible(false);
    setPrayerRequestEditorState(null);
    setPrayerPromptDeferredDateKey(prayerPromptState?.targetDateKey ?? null);
  };

  const openPrayerRequestEditor = ({
    targetDateKey,
    initialContent,
    title,
    description,
  }: {
    targetDateKey: string;
    initialContent: string;
    title: string;
    description: string;
  }) => {
    setPrayerRequestDraft(initialContent);
    setPrayerRequestEditorState({ targetDateKey, title, description });
    setPrayerRequestPromptVisible(true);
  };

  const handleSavePrayerRequest = async () => {
    if (!currentUser || !currentGroup || !prayerRequestEditorState) {
      return;
    }

    try {
      setPrayerRequestBusy(true);
      await upsertGroupPrayerRequest(
        currentUser,
        currentGroup,
        prayerRequestDraft,
        prayerRequestEditorState.targetDateKey,
      );
      setPrayerRequestPromptVisible(false);
      setPrayerRequestEditorState(null);
      setPrayerPromptDeferredDateKey(null);
    } catch (error) {
      Alert.alert("중보기도 내용 저장 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setPrayerRequestBusy(false);
    }
  };

  const handleSaveReminderPrompt = async () => {
    if (!currentUser) {
      return;
    }

    try {
      setNotificationBusy("daily");
      const granted = await requestNotificationPermission();

      if (!granted) {
        Alert.alert("알림 권한 필요", "이 시간에 알려드리려면 알림 권한을 허용해 주세요.");
        return;
      }

      const nextSettings: NotificationSettings = {
        ...currentUser.notificationSettings,
        dailyReminderEnabled: true,
        reminderHour: reminderDraft.hour,
        reminderMinute: reminderDraft.minute,
        reminderPromptSeen: true,
      };

      await syncDailyReminderNotification(nextSettings);
      await updateReminderSettings(nextSettings);
      setReminderPromptVisible(false);
    } catch (error) {
      Alert.alert("리마인더 설정 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setNotificationBusy(null);
    }
  };

  const handleToggleDailyReminder = async (nextEnabled: boolean) => {
    if (!currentUser) {
      return;
    }

    try {
      setNotificationBusy("daily");

      if (nextEnabled) {
        const granted = await requestNotificationPermission();

        if (!granted) {
          Alert.alert("알림 권한 필요", "매일 알림을 보내드리려면 알림 권한을 허용해 주세요.");
          return;
        }
      }

      const nextSettings: NotificationSettings = {
        ...currentUser.notificationSettings,
        dailyReminderEnabled: nextEnabled,
        reminderPromptSeen: true,
      };

      await syncDailyReminderNotification(nextSettings);
      await updateReminderSettings(nextSettings);
    } catch (error) {
      Alert.alert("알림 설정 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setNotificationBusy(null);
    }
  };

  const handleReminderTimeChange = async (hour: number, minute: number) => {
    if (!currentUser) {
      return;
    }

    try {
      setNotificationBusy("daily");
      const nextSettings: NotificationSettings = {
        ...currentUser.notificationSettings,
        reminderHour: hour,
        reminderMinute: minute,
        reminderPromptSeen: true,
      };

      await syncDailyReminderNotification(nextSettings);
      await updateReminderSettings(nextSettings);
    } catch (error) {
      Alert.alert("시간 변경 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setNotificationBusy(null);
    }
  };

  const handleToggleGroupPostNotifications = async (nextEnabled: boolean) => {
    if (!currentUser) {
      return;
    }

    try {
      setNotificationBusy("group-post");

      if (nextEnabled) {
        const granted = await requestNotificationPermission();

        if (!granted) {
          Alert.alert("알림 권한 필요", "멤버 글 공유 알림을 받으려면 알림 권한을 허용해 주세요.");
          return;
        }

        const expoPushToken = await getExpoPushTokenValue();
        await registerExpoPushToken(currentUser.id, expoPushToken);
      }

      await updateNotificationSettings(currentUser.id, {
        groupPostEnabled: nextEnabled,
        reminderPromptSeen: true,
      });
    } catch (error) {
      Alert.alert("푸시 알림 설정 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setNotificationBusy(null);
    }
  };

  const pickNextScripture = useCallback(() => {
    const usedKeysFromPosts = posts.flatMap((post) =>
      post.verseText ? [getScriptureKey({ text: post.verseText, reference: post.verseReference })] : [],
    );
    const nextScripture = pickScriptureAvoiding([...usedKeysFromPosts, ...recentScriptureKeysRef.current]);
    const nextKey = getScriptureKey(nextScripture);

    recentScriptureKeysRef.current = [...recentScriptureKeysRef.current.filter((key) => key !== nextKey), nextKey].slice(
      -scripturePool.length,
    );

    return nextScripture;
  }, [posts]);

  const applySelectedImage = useCallback((imageUri?: string) => {
    setDraft((current) => ({
      ...current,
      imageUri,
      scripture: imageUri ? pickNextScripture() : undefined,
    }));
  }, [pickNextScripture]);

  const launchLibraryPicker = useCallback(
    async (options?: { fromCamera?: boolean }) => {
      if (options?.fromCamera) {
        setLibraryPickerBusy(true);
      }

      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("권한 필요", "앨범에서 사진을 가져오려면 사진첩 접근을 허용해 주세요.");
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.9,
          allowsEditing: true,
          aspect: [4, 5],
        });

        if (!result.canceled) {
          if (options?.fromCamera) {
            setCameraVisible(false);
          }
          applySelectedImage(result.assets[0]?.uri);
        }
      } finally {
        if (options?.fromCamera) {
          setLibraryPickerBusy(false);
        }
      }
    },
    [applySelectedImage],
  );

  const pickImageFromLibrary = async (options?: { fromCamera?: boolean }) => {
    await launchLibraryPicker(options);
  };

  const openCustomCamera = async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!permission?.granted) {
      Alert.alert("권한 필요", "카메라로 촬영하려면 권한 허용이 필요해요.");
      return;
    }

    setCameraFacing("back");
    setCameraVisible(true);
  };

  const pickImageFromCamera = async () => {
    await openCustomCamera();
  };

  const handleCapturePhoto = async () => {
    if (!cameraRef.current || cameraBusy) {
      return;
    }

    try {
      setCameraBusy(true);
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        shutterSound: false,
        mirror: false,
      });

      setLibraryPickerBusy(false);
      setCameraVisible(false);
      if (!result?.uri) {
        applySelectedImage(undefined);
        return;
      }

      const normalizedUri =
        cameraFacing === "front"
          ? (
              await manipulateAsync(
                result.uri,
                [{ flip: FlipType.Horizontal }],
                { compress: 0.92, format: SaveFormat.JPEG },
              )
            ).uri
          : result.uri;

      applySelectedImage(normalizedUri);
    } catch (error) {
      Alert.alert("촬영 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setCameraBusy(false);
    }
  };

  const handleTabChange = async (nextTab: TabKey) => {
    setActiveTab(nextTab);

    if (nextTab !== "upload" || draft.imageUri) {
      return;
    }

    await pickImageFromCamera();
  };

  const handleContentScroll = (offsetY: number) => {
    setHeaderCollapsed(offsetY > 24);
  };

  const dismissRevealHint = async () => {
    setRevealHintVisible(false);

    try {
      await AsyncStorage.setItem(REVEAL_HINT_STORAGE_KEY, "1");
    } catch {
      // Best effort local UX preference.
    }
  };

  const handleCreatePost = async () => {
    if (uploading) {
      return;
    }

    if (!currentUser || !currentGroup || !draft.imageUri) {
      Alert.alert("업로드 준비", "로그인, 그룹 참여, 사진 선택이 먼저 필요해요.");
      return;
    }

    const selectedScripture = draft.scripture ?? pickNextScripture();
    const pendingId = `pending-${Date.now()}`;
    const pendingPost: PendingUploadPost = {
      id: pendingId,
      authorId: currentUser.id,
      authorName: currentUser.displayName,
      groupId: currentGroup.id,
      groupName: currentGroup.name,
      verseText: selectedScripture.text,
      verseReference: selectedScripture.reference,
      caption: draft.caption.trim() || "오늘 받은 은혜를 사진으로 남겼어요.",
      createdLabel: "업로드 중...",
      createdAtMs: Date.now(),
      imageUri: draft.imageUri,
      isUploading: true,
    };

    try {
      setUploading(true);
      setPendingUploads((current) => [pendingPost, ...current]);
      startTransition(() => {
        setActiveTab("home");
      });

      await createGracePost({
        authorId: currentUser.id,
        authorName: currentUser.displayName,
        groupId: currentGroup.id,
        groupName: currentGroup.name,
        verseText: selectedScripture.text,
        verseReference: selectedScripture.reference,
        caption: draft.caption,
        imageUri: draft.imageUri,
      });

      setPendingUploads((current) => current.filter((post) => post.id !== pendingId));

      startTransition(() => {
        setDraft({
          imageUri: undefined,
          scripture: undefined,
          caption: "",
        });
      });
    } catch (error) {
      setPendingUploads((current) => current.filter((post) => post.id !== pendingId));
      startTransition(() => {
        setActiveTab("upload");
      });
      Alert.alert("업로드 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePost = async () => {
    if (!deletingPostId) {
      return;
    }

    const targetPost = posts.find((post) => post.id === deletingPostId);
    if (!targetPost) {
      setDeletingPostId(null);
      return;
    }

    try {
      await deleteGracePost(targetPost);
      setDeletingPostId(null);
    } catch (error) {
      Alert.alert("삭제 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
    }
  };

  const handleRenameDisplayName = async (nextDisplayName: string) => {
    if (!currentUser) {
      return false;
    }

    try {
      setDisplayNameBusy(true);
      await renameUserDisplayName(currentUser, nextDisplayName);
      const trimmedName = nextDisplayName.trim();
      setCurrentUser((previous) => (previous ? { ...previous, displayName: trimmedName } : previous));
      return true;
    } catch (error) {
      Alert.alert("이름 변경 실패", error instanceof Error ? error.message : "다시 시도해 주세요.");
      return false;
    } finally {
      setDisplayNameBusy(false);
    }
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppBackground />
        <BrandSplash copy="오늘 은혜를 조용히 준비하고 있어요" />
      </SafeAreaView>
    );
  }

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppBackground />
        <ScrollView contentContainerStyle={styles.onboardingScroll}>
          <View style={styles.heroPanel}>
            <Text style={styles.eyebrow}>교회 사진 공동체</Text>
            <Text style={styles.heroTitle}>오늘 은혜</Text>
            <Text style={styles.heroSubtitle}>
              오늘 받은 은혜를
              {"\n"}
              사진과 말씀으로 함께 나눠요
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>소셜 로그인으로 시작</Text>
            <Text style={styles.sectionDescription}>
              로그인하고
              {"\n"}
              우리 공동체에 바로 들어와 보세요.
            </Text>

            {appleAvailable ? (
              <View>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  cornerRadius={16}
                  style={styles.appleButton}
                  onPress={handleAppleLogin}
                />
              </View>
            ) : (
              <View style={styles.unavailableCard}>
                <Ionicons name="logo-apple" size={18} color={theme.colors.textSecondary} />
                <Text style={styles.unavailableText}>Apple 로그인은 iPhone에서 사용할 수 있어요.</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.kakaoButton,
                authBusy === "kakao" || pressed ? styles.kakaoButtonPressed : null,
              ]}
              onPress={handleKakaoLogin}
            >
              <Ionicons name="chatbubble-ellipses" size={18} color="#3C2A00" />
              <Text style={styles.kakaoButtonLabel}>
                {authBusy === "kakao" ? "Kakao 로그인 중..." : "카카오로 시작하기"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {authBusy ? (
          <BrandSplash
            copy={authBusy === "apple" ? "Apple로 오늘 은혜에 들어가는 중이에요" : "카카오로 오늘 은혜에 들어가는 중이에요"}
            overlay
          />
        ) : null}
      </SafeAreaView>
    );
  }

  if (!currentUser.groupId || !currentGroup) {
    if (legalConsentRequired) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <AppBackground />
          <View style={styles.legalGateShell}>
          <View style={styles.legalGateHeader}>
            <Text style={styles.eyebrow}>{currentUser.displayName} 님 환영해요</Text>
            <Text style={styles.legalGateTitle}>이용약관 동의</Text>
            <Text style={styles.legalGateDescription}>아래 항목에 동의하면 계속할 수 있어요.</Text>
          </View>

            <View style={styles.legalGateBody}>
              <ConsentChecklistCard
                consentDraft={legalConsentDraft}
                onToggle={(consentId) =>
                  setLegalConsentDraft((current) => ({
                    ...current,
                    [consentId]: !current[consentId],
                  }))
                }
                onOpenDocument={openLegalInfoPage}
              />
            </View>

            <View style={styles.legalGateFooter}>
              <PrimaryButton
                label={legalConsentSaving ? "저장 중..." : "동의하고 계속하기"}
                disabled={legalConsentSaving}
                onPress={handleAcceptLegalConsents}
              />
              <SecondaryButton label="가입 취소" onPress={handleDismissLegalConsentPrompt} />
            </View>
          </View>

          <Modal
            animationType="slide"
            presentationStyle="fullScreen"
            visible={legalInfoPageVisible}
            onRequestClose={() => setLegalInfoPageVisible(false)}
          >
            <LegalInfoPage
              initialDocumentId={legalInfoInitialDocumentId}
              onClose={() => setLegalInfoPageVisible(false)}
            />
          </Modal>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <AppBackground />
        <KeyboardAvoidingView
          style={styles.onboardingKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.onboardingScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
            <View style={styles.heroPanel}>
              <Text style={styles.eyebrow}>{currentUser.displayName} 님 환영해요</Text>
              <Text style={styles.heroTitle}>함께할 그룹을 정해요</Text>
              <Text style={styles.heroSubtitle}>
                새 공동체를 만들거나,
                {"\n"}
                초대 코드로 바로 함께할 수 있어요.
              </Text>
            </View>

            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>새 그룹 만들기</Text>
                <Text style={styles.sectionDescription}>
                  내가 만든 공동체에
                  {"\n"}
                  멤버를 초대할 수 있어요.
                </Text>
                <LabeledField
                  label="그룹 이름"
                  value={groupNameInput}
                  placeholder="예: 청년부 2조"
                  onChangeText={setGroupNameInput}
                />
                <PrimaryButton
                  label={groupBusy === "create" ? "그룹 만드는 중..." : "내 그룹 만들기"}
                  onPress={handleCreateGroup}
                />
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>초대 코드로 참여</Text>
                <Text style={styles.sectionDescription}>
                  받은 초대 코드로
                  {"\n"}
                  바로 들어올 수 있어요.
                </Text>
                <LabeledField
                  label="초대 코드"
                  value={inviteCodeInput}
                  placeholder="AB12CD"
                  autoCapitalize="characters"
                  onChangeText={(value) => setInviteCodeInput(value.toUpperCase())}
                />
                <SecondaryButton
                  label={groupBusy === "join" ? "참여하는 중..." : "그룹 참여하기"}
                  onPress={handleJoinGroup}
                />
              </View>

              <Pressable style={styles.signOutTextButton} onPress={handleSignOut}>
                <Text style={styles.signOutTextLabel}>로그아웃</Text>
              </Pressable>
            </>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          animationType="slide"
          presentationStyle="fullScreen"
          visible={legalInfoPageVisible}
          onRequestClose={() => setLegalInfoPageVisible(false)}
        >
          <LegalInfoPage
            initialDocumentId={legalInfoInitialDocumentId}
            onClose={() => setLegalInfoPageVisible(false)}
          />
        </Modal>

        <Modal
          animationType="fade"
          transparent
          visible={reminderPromptVisible}
          onRequestClose={() => {
            void handleSkipReminderPrompt();
          }}
        >
          <ReminderPromptModal
            selectedHour={reminderDraft.hour}
            selectedMinute={reminderDraft.minute}
            busy={notificationBusy === "daily"}
            onSelect={(hour, minute) => setReminderDraft({ hour, minute })}
            onLater={() => {
              void handleSkipReminderPrompt();
            }}
            onConfirm={() => {
              void handleSaveReminderPrompt();
            }}
          />
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppBackground />
      <View style={styles.appShell}>
        <Animated.View
          style={[
            styles.headerShell,
            {
              height: animatedHeaderHeight,
              opacity: animatedHeaderOpacity,
              marginBottom: animatedHeaderMargin,
            },
          ]}
        >
          <Header
            activeTab={activeTab}
            userName={currentUser.displayName}
            groupName={currentGroup.name}
            onOpenVerseCollection={() => setVerseCollectionVisible(true)}
          />
        </Animated.View>

        <View style={styles.contentArea}>
          {activeTab === "home" ? (
            <HomeTab
              user={currentUser}
              group={currentGroup}
              posts={homePosts}
              currentUserId={currentUser.id}
              loading={feedLoading}
              error={feedError}
              onGoUpload={() => setActiveTab("upload")}
              onScrollChange={handleContentScroll}
              revealHintVisible={revealHintVisible}
              onDismissRevealHint={() => {
                void dismissRevealHint();
              }}
              onEditPrayerRequest={(prayerFocus) =>
                openPrayerRequestEditor({
                  targetDateKey: prayerFocus.todayDateKey,
                  initialContent: prayerFocus.todayPrayerRequest?.content ?? "",
                  title: "오늘 받을 중보기도를 적어 주세요",
                  description: `오늘은 ${currentUser.displayName} 님 차례예요. 공동체가 지금 붙들고 기도하면 좋을 내용을 적어 주세요.`,
                })
              }
              onOpenPostMenu={handleOpenPostMenu}
            />
          ) : null}

          {activeTab === "upload" ? (
            <UploadTab
              scripture={draft.scripture}
              caption={draft.caption}
              imageUri={draft.imageUri}
              uploading={uploading}
              onCaptionChange={(caption) => setDraft((current) => ({ ...current, caption }))}
              onLibraryPress={pickImageFromLibrary}
              onCameraPress={pickImageFromCamera}
              onClearImage={() => applySelectedImage(undefined)}
              onSubmit={handleCreatePost}
              onScrollChange={handleContentScroll}
            />
          ) : null}

          {activeTab === "mine" ? (
            <GroupTab
              group={currentGroup}
              user={currentUser}
              posts={myPosts}
              panel={communityPanel}
              notificationBusy={notificationBusy}
              groupBusy={groupBusy}
              onPanelChange={setCommunityPanel}
              onCopyInviteCode={handleCopyInviteCode}
              onRegenerateInviteCode={handleRegenerateInviteCode}
              onRenameGroup={handleRenameCurrentGroup}
              onLeaveGroup={handleLeaveGroup}
              onDeletePress={(postId) => setDeletingPostId(postId)}
              onToggleDailyReminder={handleToggleDailyReminder}
              onChangeReminderTime={handleReminderTimeChange}
              onToggleGroupPostNotifications={handleToggleGroupPostNotifications}
              groupUpgradeState={groupUpgradeState}
              upgradeRefreshing={upgradeRefreshing}
              upgradeActionBusy={upgradeActionBusy}
              onPurchaseGrowthPlan={handlePurchaseGrowthPlan}
              onRestoreGrowthPlan={handleRestoreGrowthPlan}
              onDeleteAccount={handleDeleteAccount}
              accountBusy={accountBusy}
              displayNameBusy={displayNameBusy}
              onRenameDisplayName={handleRenameDisplayName}
              onSignOut={handleSignOut}
              onOpenLegalInfoPage={openLegalInfoPage}
              onScrollChange={handleContentScroll}
            />
          ) : null}
        </View>

        <BottomTabs activeTab={activeTab} onChange={handleTabChange} />
      </View>

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={legalInfoPageVisible}
        onRequestClose={() => setLegalInfoPageVisible(false)}
      >
        <LegalInfoPage
          initialDocumentId={legalInfoInitialDocumentId}
          onClose={() => setLegalInfoPageVisible(false)}
        />
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={reminderPromptVisible}
        onRequestClose={() => {
          void handleSkipReminderPrompt();
        }}
      >
        <ReminderPromptModal
          selectedHour={reminderDraft.hour}
          selectedMinute={reminderDraft.minute}
          busy={notificationBusy === "daily"}
          onSelect={(hour, minute) => setReminderDraft({ hour, minute })}
          onLater={() => {
            void handleSkipReminderPrompt();
          }}
          onConfirm={() => {
            void handleSaveReminderPrompt();
          }}
        />
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(ownerTransferMode)}
        onRequestClose={closeOwnerTransferModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>다음 그룹 오너를 선택해 주세요</Text>
            <Text style={styles.modalDescription}>
              {ownerTransferMode === "delete"
                ? "선택한 멤버에게 공동체 오너 권한을 넘긴 뒤 회원 탈퇴를 진행해요."
                : "선택한 멤버에게 공동체 오너 권한을 넘긴 뒤 그룹에서 나가요."}
            </Text>

            <View style={styles.ownerTransferList}>
              {ownerTransferCandidates.map((memberProfile) => {
                const isSelected = ownerTransferTargetUserId === memberProfile.userId;

                return (
                  <Pressable
                    key={memberProfile.userId ?? memberProfile.displayName}
                    style={({ pressed }) => [
                      styles.ownerTransferOption,
                      isSelected ? styles.ownerTransferOptionSelected : null,
                      pressed ? styles.foldToggleButtonPressed : null,
                    ]}
                    onPress={() => setOwnerTransferTargetUserId(memberProfile.userId ?? null)}
                  >
                    <View style={styles.ownerTransferOptionCopy}>
                      <Text style={styles.ownerTransferOptionName}>{memberProfile.displayName}</Text>
                      <Text style={styles.ownerTransferOptionHint}>다음 그룹 오너</Text>
                    </View>
                    <Ionicons
                      name={isSelected ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={isSelected ? theme.colors.accentPrimary : theme.colors.textTertiary}
                    />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <SecondaryButton label="취소" onPress={closeOwnerTransferModal} />
              <PrimaryButton
                compact
                label={
                  ownerTransferMode === "delete"
                    ? accountBusy
                      ? "탈퇴 처리 중..."
                      : "위임하고 탈퇴"
                    : groupBusy === "leave"
                      ? "나가는 중..."
                      : "위임하고 나가기"
                }
                disabled={!ownerTransferTargetUserId || accountBusy || groupBusy === "leave"}
                onPress={() => {
                  if (!ownerTransferTargetUserId) {
                    return;
                  }

                  if (ownerTransferMode === "delete") {
                    void performDeleteAccount(ownerTransferTargetUserId);
                    return;
                  }

                  void performLeaveGroup(ownerTransferTargetUserId);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={Boolean(deletingPostId)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>게시물을 삭제할까요?</Text>
            <Text style={styles.modalDescription}>삭제하면 다시 복구할 수 없어요.</Text>
            <View style={styles.modalActions}>
              <SecondaryButton label="취소" onPress={() => setDeletingPostId(null)} />
              <PrimaryButton compact label="삭제" onPress={handleDeletePost} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={verseCollectionVisible}
        onRequestClose={() => setVerseCollectionVisible(false)}
      >
        <VerseCollectionModal
          items={verseCollection}
          currentMonthLabel={currentMonthLabel}
          onClose={() => setVerseCollectionVisible(false)}
        />
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={prayerRequestPromptVisible}
        onRequestClose={handleDeferPrayerRequestPrompt}
      >
        <KeyboardAvoidingView
          style={styles.prayerRequestModalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <View style={styles.prayerRequestModalBackdrop}>
            <View style={styles.prayerRequestModalCard}>
              <Text style={styles.modalTitle}>{prayerRequestEditorState?.title ?? "중보기도를 적어 주세요"}</Text>
              <Text style={styles.modalDescription}>
                {prayerRequestEditorState?.description ?? "공동체가 함께 기도할 내용을 적어 주세요."}
              </Text>
              <TextInput
                value={prayerRequestDraft}
                onChangeText={setPrayerRequestDraft}
                placeholder="예: 이번 주 면접을 앞두고 마음이 흔들리지 않도록 기도해 주세요."
                placeholderTextColor={theme.colors.textTertiary}
                style={styles.prayerRequestInput}
                multiline
                textAlignVertical="top"
                autoFocus
              />
              <View style={styles.reminderPromptActions}>
                <SecondaryButton label="나중에 적을게요" onPress={handleDeferPrayerRequestPrompt} />
                <PrimaryButton
                  compact
                  label={prayerRequestBusy ? "저장하는 중..." : "내용 저장"}
                  onPress={() => {
                    void handleSavePrayerRequest();
                  }}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CameraCaptureModal
        visible={cameraVisible}
        permissionGranted={Boolean(cameraPermission?.granted)}
        cameraRef={cameraRef}
        facing={cameraFacing}
        busy={cameraBusy}
        libraryBusy={libraryPickerBusy}
        onClose={() => {
          setLibraryPickerBusy(false);
          setCameraVisible(false);
        }}
        onCapture={() => {
          void handleCapturePhoto();
        }}
        onFlip={() => setCameraFacing((current) => (current === "back" ? "front" : "back"))}
        onOpenLibrary={() => {
          void pickImageFromLibrary({ fromCamera: true });
        }}
      />

      {authBusy ? (
        <BrandSplash
          copy={authBusy === "apple" ? "Apple로 오늘 은혜에 들어가는 중이에요" : "카카오로 오늘 은혜에 들어가는 중이에요"}
          overlay
        />
      ) : null}
    </SafeAreaView>
  );
}

function Header({
  activeTab,
  userName,
  groupName,
  onOpenVerseCollection,
}: {
  activeTab: TabKey;
  userName: string;
  groupName: string;
  onOpenVerseCollection: () => void;
}) {
  const copy =
    activeTab === "home"
      ? `${groupName}의 은혜의 순간을 모아보세요`
      : activeTab === "upload"
        ? "그룹 안에 사진 한 장을 조용히 남겨보세요"
        : `${userName} 님의 공동체와 초대 현황`;

  return (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        <Text style={styles.headerBrand}>오늘 은혜</Text>
        <Pressable
          style={({ pressed }) => [styles.collectionIconButton, pressed ? styles.collectionIconButtonPressed : null]}
          onPress={onOpenVerseCollection}
        >
          <View style={styles.collectionIconStack}>
            <View style={styles.collectionIconBackFar} />
            <View style={styles.collectionIconBackNear} />
            <View style={styles.collectionIconFront}>
              <Ionicons name="book-outline" size={18} color={theme.colors.accentPrimary} />
            </View>
          </View>
        </Pressable>
      </View>
      <Text numberOfLines={1} style={styles.headerCopy}>
        {copy}
      </Text>
    </View>
  );
}

function HomeTab({
  user,
  group,
  posts,
  currentUserId,
  loading,
  error,
  onGoUpload,
  onScrollChange,
  revealHintVisible,
  onDismissRevealHint,
  onEditPrayerRequest,
  onOpenPostMenu,
}: {
  user: AppUser;
  group: GroupSummary;
  posts: GracePost[];
  currentUserId: string;
  loading: boolean;
  error: string | null;
  onGoUpload: () => void;
  onScrollChange: (offsetY: number) => void;
  revealHintVisible: boolean;
  onDismissRevealHint: () => void;
  onEditPrayerRequest: (prayerFocus: ReturnType<typeof buildTodayPrayerFocus>) => void;
  onOpenPostMenu: (post: GracePost) => void;
}) {
  const prayerFocus = buildTodayPrayerFocus(group);

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={theme.colors.accentPrimary} />
        <Text style={styles.centerStateText}>그룹 피드를 불러오는 중이에요</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyTitle}>피드를 불러오지 못했어요</Text>
        <Text style={styles.emptyDescription}>{error}</Text>
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => onScrollChange(event.nativeEvent.contentOffset.y)}
      >
        <PrayerFocusCard
          prayerFocus={prayerFocus}
          currentUserId={user.id}
          userName={user.displayName}
          onEditPrayerRequest={() => onEditPrayerRequest(prayerFocus)}
        />
        <View style={styles.feedEmptyStateCard}>
          <Text style={styles.emptyTitle}>아직 우리 그룹 사진이{"\n"}없어요</Text>
          <Text style={styles.emptyDescription}>오늘 순번을 보고{"\n"}첫 은혜 사진부터 올려보세요.</Text>
          <PrimaryButton label="첫 사진 올리기" onPress={onGoUpload} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.feedContent}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => onScrollChange(event.nativeEvent.contentOffset.y)}
    >
      <PrayerFocusCard
        prayerFocus={prayerFocus}
        currentUserId={user.id}
        userName={user.displayName}
        onEditPrayerRequest={() => onEditPrayerRequest(prayerFocus)}
      />

      {revealHintVisible ? (
        <View style={styles.feedTipCard}>
          <View style={styles.feedTipCopy}>
            <Text style={styles.feedTipTitle}>사진 꾹 누르기</Text>
            <Text style={styles.feedTipDescription}>길게 누르는 동안 말씀 오버레이가 사라지고 원본 사진이 보여요.</Text>
          </View>
          <Pressable style={styles.feedTipClose} onPress={onDismissRevealHint}>
            <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {posts.map((post) => (
        <PhotoCard
          key={post.id}
          post={post}
          uploading={"isUploading" in post && post.isUploading === true}
          showMenu={!("isUploading" in post && post.isUploading === true)}
          isMyPost={post.authorId === currentUserId}
          onMorePress={() => onOpenPostMenu(post)}
          onRevealHintSeen={revealHintVisible ? onDismissRevealHint : undefined}
        />
      ))}
    </ScrollView>
  );
}

function PrayerFocusCard({
  prayerFocus,
  currentUserId,
  userName,
  onEditPrayerRequest,
}: {
  prayerFocus: ReturnType<typeof buildTodayPrayerFocus>;
  currentUserId: string;
  userName: string;
  onEditPrayerRequest: () => void;
}) {
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(prayerFocus.todayIndex);

  useEffect(() => {
    setSelectedMemberIndex(prayerFocus.todayIndex);
  }, [prayerFocus.todayIndex, prayerFocus.todayMemberName, prayerFocus.todayMemberUserId]);

  const selectedMember = prayerFocus.memberSlots[selectedMemberIndex] ?? prayerFocus.memberSlots[prayerFocus.todayIndex];
  const isMyTurn =
    selectedMember?.isToday &&
    (selectedMember.memberUserId
      ? selectedMember.memberUserId === currentUserId
      : selectedMember?.memberName === userName);
  const activePrayerRequest = selectedMember?.prayerRequest ?? null;
  const hasPrayerRequest = Boolean(activePrayerRequest?.content.trim());
  const canEditPrayerRequest = isMyTurn;
  const selectedMemberName = selectedMember?.memberName ?? prayerFocus.todayMemberName;
  const rosterSlots = [...prayerFocus.memberSlots].sort((left, right) => left.dayOffset - right.dayOffset);

  return (
    <View style={styles.prayerFocusCard}>
      <View style={styles.prayerFocusHeader}>
        <View style={styles.prayerFocusHeaderTop}>
          <Text style={styles.prayerFocusEyebrow}>오늘의 기도자</Text>
          <View style={styles.prayerFocusBadge}>
            <Ionicons name="heart-outline" size={16} color={theme.colors.accentPrimary} />
            <Text style={styles.prayerFocusBadgeText}>{selectedMember?.cycleLabel ?? prayerFocus.cycleLabel}</Text>
          </View>
        </View>
        <View style={styles.prayerFocusTitleBlock}>
          <View style={styles.prayerFocusTitleWrap}>
            <Text style={styles.prayerFocusTitle}>{selectedMemberName}님을 위해</Text>
            <Text style={styles.prayerFocusTitleSecondary}>기도해주세요</Text>
          </View>
          <Text style={styles.prayerFocusDescription}>
            {selectedMember?.isToday
              ? isMyTurn
                ? "오늘은 내가 기도받는 날이에요.\n사진과 함께 기도 제목을 남겨보세요."
                : "오늘의 기도자를 위해\n짧은 중보기도 한 줄을 남겨보세요."
              : `${selectedMemberName}님의 순서를 기다리며\n중보기도 내용을 미리 확인해 보세요.`}
          </Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.prayerFocusPrompt,
          canEditPrayerRequest ? styles.prayerFocusPromptEditable : null,
          pressed && canEditPrayerRequest ? styles.prayerFocusPromptPressed : null,
        ]}
        disabled={!canEditPrayerRequest}
        onPress={onEditPrayerRequest}
      >
        <Text style={styles.prayerFocusPromptTitle}>
          {hasPrayerRequest
            ? `${selectedMemberName}님의 중보기도`
            : canEditPrayerRequest
              ? "탭해서 중보기도 적기"
              : `${selectedMemberName}님의 중보기도`}
        </Text>
        <Text style={styles.prayerFocusPromptText}>
          {hasPrayerRequest
            ? activePrayerRequest?.content
            : isMyTurn
              ? `${prayerFocus.nextMemberName}님 차례가 오기 전까지,\n오늘 받은 은혜와 함께\n기도받고 싶은 내용을 남겨보세요.`
              : selectedMember?.isToday
                ? `${prayerFocus.todayMemberName}님을 위해\n축복 한 줄, 감사 한 줄,\n기도 제목 한 줄을 남겨보세요.`
                : `${selectedMemberName}님이 아직 중보기도 내용을 적지 않았어요.`}
        </Text>
        {canEditPrayerRequest ? (
          <View style={styles.prayerFocusEditRow}>
            <Ionicons name="create-outline" size={14} color={theme.colors.accentPrimary} />
            <Text style={styles.prayerFocusEditText}>
              {hasPrayerRequest ? "눌러서 내용 수정하기" : "눌러서 지금 내용 적기"}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.prayerFocusRoster}
        style={styles.prayerFocusRosterScroll}
      >
        {rosterSlots.map((member) => {
          const isSelected = member.index === selectedMemberIndex;
          const isToday = member.isToday;

          return (
            <Pressable
          key={`${member.memberUserId ?? member.memberName}-${member.index}`}
              onPress={() => setSelectedMemberIndex(member.index)}
              style={[
                styles.prayerFocusChip,
                isToday ? styles.prayerFocusChipToday : null,
                isSelected ? styles.prayerFocusChipActive : null,
              ]}
            >
              <Text
                style={[
                  styles.prayerFocusChipText,
                  isSelected ? styles.prayerFocusChipTextActive : null,
                ]}
              >
                {member.memberName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function buildTodayPrayerFocus(group: GroupSummary) {
  const memberProfiles = dedupePrayerMemberProfiles(group.memberProfiles);
  const fallbackMembers = memberProfiles.length > 0 ? memberProfiles : [{ displayName: "우리 공동체" }];
  const cycleSize = fallbackMembers.length;
  const today = startOfDay(new Date());
  const anchorDate = new Date(2026, 0, 1);
  const elapsedDays = Math.floor((today.getTime() - anchorDate.getTime()) / (24 * 60 * 60 * 1000));
  const groupOffset = getPrayerGroupOffset(group.id, cycleSize);
  const todayIndex = ((elapsedDays + groupOffset) % cycleSize + cycleSize) % cycleSize;
  const nextMember = fallbackMembers[(todayIndex + 1) % cycleSize] ?? fallbackMembers[todayIndex];
  const todayDateKey = formatPrayerDateKey(today);
  const nextDateKey = formatPrayerDateKey(addDays(today, 1));
  const memberSlots = fallbackMembers.map((memberProfile, index) => {
    const dayOffset = ((index - todayIndex) % cycleSize + cycleSize) % cycleSize;
    const targetDateKey = formatPrayerDateKey(addDays(today, dayOffset));

    return {
      index,
      dayOffset,
      memberName: memberProfile.displayName,
      memberUserId: memberProfile.userId,
      isToday: index === todayIndex,
      targetDateKey,
      cycleLabel: `${index + 1}/${cycleSize} 순번`,
      prayerRequest: readPrayerRequestForDate(group.prayerRequests, memberProfile, targetDateKey),
    };
  });
  const todayPrayerRequest = memberSlots[todayIndex]?.prayerRequest ?? null;

  return {
    members: fallbackMembers.map((memberProfile) => memberProfile.displayName),
    memberSlots,
    todayIndex,
    todayMemberName: fallbackMembers[todayIndex]?.displayName ?? "우리 공동체",
    todayMemberUserId: fallbackMembers[todayIndex]?.userId ?? null,
    todayDateKey,
    nextMemberName: nextMember?.displayName ?? "우리 공동체",
    nextMemberUserId: nextMember?.userId ?? null,
    nextDateKey,
    todayPrayerRequest,
    cycleLabel: `${todayIndex + 1}/${cycleSize} 순번`,
  };
}

function getPrayerGroupOffset(groupId: string, cycleSize: number) {
  if (cycleSize <= 0) {
    return 0;
  }

  return Array.from(groupId).reduce((sum, character) => sum + character.charCodeAt(0), 0) % cycleSize;
}

function buildPrayerRequestPrompt(group: GroupSummary, user: { id: string; displayName: string }) {
  const prayerFocus = buildTodayPrayerFocus(group);

  const isNextTarget = prayerFocus.nextMemberUserId
    ? prayerFocus.nextMemberUserId === user.id
    : prayerFocus.nextMemberName === user.displayName;

  if (prayerFocus.members.length <= 1 || !isNextTarget) {
    return null;
  }

  const existingPrayerRequest = readPrayerRequestForDate(
    group.prayerRequests,
    {
      userId: user.id,
      displayName: user.displayName,
    },
    prayerFocus.nextDateKey,
  );

  return {
    targetDateKey: prayerFocus.nextDateKey,
    existingContent: existingPrayerRequest?.content ?? "",
    shouldPrompt: !existingPrayerRequest?.content.trim(),
  };
}

function shouldNormalizeLegacyDisplayName(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed === "오늘은혜 사용자" || trimmed === "Apple 사용자" || trimmed.includes("@");
}

function buildPreferredAppleDisplayName(sourceId: string) {
  const normalizedSource = sourceId.trim();
  const numericTail = normalizedSource.replace(/\D/g, "").slice(-4);
  const alphaNumericTail = normalizedSource.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  const suffix = (numericTail || alphaNumericTail || "0001").padStart(4, "0");
  return `은혜#${suffix}`;
}

function readPrayerRequestForDate(
  prayerRequests: GroupSummary["prayerRequests"],
  member: {
    userId?: string;
    displayName: string;
  },
  targetDateKey: string,
) {
  const prayerRequest =
    (member.userId ? prayerRequests[member.userId] : null) ?? prayerRequests[member.displayName];

  if (!prayerRequest || prayerRequest.targetDateKey !== targetDateKey) {
    return null;
  }

  return prayerRequest;
}

function dedupePrayerMemberProfiles(memberProfiles: GroupSummary["memberProfiles"]) {
  const seen = new Set<string>();

  return memberProfiles.filter((memberProfile) => {
    const displayName = memberProfile.displayName.trim();
    if (!displayName) {
      return false;
    }

    const key = memberProfile.userId ?? `name:${displayName}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatPrayerDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function UploadTab({
  imageUri,
  scripture,
  caption,
  uploading,
  onCaptionChange,
  onLibraryPress,
  onCameraPress,
  onClearImage,
  onSubmit,
  onScrollChange,
}: {
  imageUri?: string;
  scripture?: ScriptureCard;
  caption: string;
  uploading: boolean;
  onCaptionChange: (value: string) => void;
  onLibraryPress: () => void;
  onCameraPress: () => void;
  onClearImage: () => void;
  onSubmit: () => void;
  onScrollChange: (offsetY: number) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.uploadContent}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => onScrollChange(event.nativeEvent.contentOffset.y)}
    >
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>오늘의 은혜 올리기</Text>
        <Text style={styles.sectionDescription}>멤버들만 볼 수 있는 게시글이에요.</Text>

        {imageUri ? (
          <View style={styles.previewWrap}>
            <View style={styles.previewFrame}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} contentFit="cover" />
              {scripture ? <VerseOverlay text={scripture.text} reference={scripture.reference} preview /> : null}
            </View>
            <Pressable style={styles.previewReplace} onPress={onClearImage}>
              <Ionicons name="refresh-outline" size={16} color={theme.colors.textPrimary} />
              <Text style={styles.previewReplaceText}>다시 선택</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.photoPickerArea}>
            <View style={styles.photoPickerArtwork}>
              <Ionicons name="images-outline" size={34} color={theme.colors.accentPrimary} />
            </View>
            <Text style={styles.photoPickerTitle}>사진 1장 선택</Text>
            <Text style={styles.photoPickerDescription}>
              업로드 탭을 누르면 카메라가 먼저 열려요. 예배, 봉사, 풍경, 사람 어떤 순간이든 괜찮아요.
            </Text>
            <View style={styles.uploadButtonRow}>
              <PrimaryButton compact label="카메라로 바로 촬영" onPress={onCameraPress} />
              <SecondaryButton label="앨범에서 선택" onPress={onLibraryPress} />
            </View>
          </View>
        )}

        {scripture ? (
          <View style={styles.captionSection}>
            <Text style={styles.fieldLabel}>오늘의 말씀</Text>
            <View style={styles.scriptureInfoCard}>
              <Text style={styles.scriptureInfoText}>{scripture.text}</Text>
              <Text style={styles.scriptureInfoReference}>{scripture.reference}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.captionSection}>
          <Text style={styles.fieldLabel}>한 줄 나눔</Text>
          <TextInput
            placeholder="오늘 받은 은혜를 짧게 적어보세요"
            placeholderTextColor={theme.colors.textTertiary}
            value={caption}
            onChangeText={onCaptionChange}
            multiline
            style={styles.captionInput}
          />
        </View>

        {imageUri ? (
          <PrimaryButton
            label={uploading ? "업로드하는 중..." : "오늘의 은혜 기록하기"}
            onPress={onSubmit}
            disabled={uploading}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function CameraCaptureModal({
  visible,
  permissionGranted,
  cameraRef,
  facing,
  busy,
  libraryBusy,
  onClose,
  onCapture,
  onFlip,
  onOpenLibrary,
}: {
  visible: boolean;
  permissionGranted: boolean;
  cameraRef: React.RefObject<CameraView | null>;
  facing: CameraType;
  busy: boolean;
  libraryBusy?: boolean;
  onClose: () => void;
  onCapture: () => void;
  onFlip: () => void;
  onOpenLibrary: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <SafeAreaView style={styles.cameraModalShell}>
        {permissionGranted ? (
          <CameraView
            ref={cameraRef}
            style={styles.cameraView}
            facing={facing}
            active={visible && !libraryBusy}
            animateShutter={false}
            mirror={false}
          />
        ) : (
          <View style={styles.cameraPermissionFallback}>
            <Text style={styles.cameraPermissionTitle}>카메라 권한이 필요해요</Text>
            <Text style={styles.cameraPermissionDescription}>
              촬영으로 바로 올리려면 카메라 접근을 허용해 주세요.
            </Text>
          </View>
        )}

        {permissionGranted ? (
          <View pointerEvents="none" style={styles.cameraGuideLayer}>
            <View style={styles.cameraGuideFrame}>
              <View style={styles.cameraGuideBadge}>
                <Text style={styles.cameraGuideBadgeText}>이 영역이 기록돼요</Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <Pressable
              style={({ pressed }) => [styles.cameraIconButton, pressed ? styles.cameraIconButtonPressed : null]}
              onPress={onClose}
            >
              <Ionicons name="close" size={22} color={theme.colors.white} />
            </Pressable>
          </View>

          <View style={styles.cameraBottomBar}>
            <Pressable
              style={({ pressed }) => [styles.cameraSideButton, pressed ? styles.cameraIconButtonPressed : null]}
              onPress={onOpenLibrary}
              disabled={busy || libraryBusy}
            >
              {libraryBusy ? (
                <ActivityIndicator color={theme.colors.white} />
              ) : (
                <>
                  <Ionicons name="images-outline" size={20} color={theme.colors.white} />
                  <Text style={styles.cameraSideButtonLabel}>앨범</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.cameraShutterButton,
                (pressed || busy || libraryBusy) ? styles.cameraShutterButtonPressed : null,
              ]}
              onPress={onCapture}
              disabled={busy || libraryBusy}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.textPrimary} />
              ) : (
                <View style={styles.cameraShutterInner} />
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.cameraSideButton, pressed ? styles.cameraIconButtonPressed : null]}
              onPress={onFlip}
              disabled={busy || libraryBusy}
            >
              <Ionicons name="camera-reverse-outline" size={20} color={theme.colors.white} />
              <Text style={styles.cameraSideButtonLabel}>전환</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
  );
}

function GroupTab({
  user,
  group,
  posts,
  panel,
  notificationBusy,
  groupBusy,
  groupUpgradeState,
  upgradeRefreshing,
  upgradeActionBusy,
  onPanelChange,
  onCopyInviteCode,
  onRegenerateInviteCode,
  onRenameGroup,
  onLeaveGroup,
  onDeletePress,
  onToggleDailyReminder,
  onChangeReminderTime,
  onToggleGroupPostNotifications,
  onPurchaseGrowthPlan,
  onRestoreGrowthPlan,
  onDeleteAccount,
  accountBusy,
  displayNameBusy,
  onRenameDisplayName,
  onSignOut,
  onOpenLegalInfoPage,
  onScrollChange,
}: {
  user: AppUser;
  group: GroupSummary;
  posts: GracePost[];
  panel: "community" | "settings";
  notificationBusy: "daily" | "group-post" | null;
  groupBusy: "create" | "join" | "regen" | "leave" | "rename" | null;
  groupUpgradeState: GroupUpgradeState;
  upgradeRefreshing: boolean;
  upgradeActionBusy: "purchase" | "restore" | null;
  onPanelChange: (panel: "community" | "settings") => void;
  onCopyInviteCode: () => void;
  onRegenerateInviteCode: () => void;
  onRenameGroup: (nextGroupName: string) => Promise<boolean>;
  onLeaveGroup: () => void;
  onDeletePress: (postId: string) => void;
  onToggleDailyReminder: (enabled: boolean) => void;
  onChangeReminderTime: (hour: number, minute: number) => void;
  onToggleGroupPostNotifications: (enabled: boolean) => void;
  onPurchaseGrowthPlan: () => Promise<boolean>;
  onRestoreGrowthPlan: () => Promise<boolean>;
  onDeleteAccount: () => void;
  accountBusy: boolean;
  displayNameBusy: boolean;
  onRenameDisplayName: (nextDisplayName: string) => Promise<boolean>;
  onSignOut: () => void;
  onOpenLegalInfoPage: (documentId?: LegalDocumentId) => void;
  onScrollChange: (offsetY: number) => void;
}) {
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [developerNoteExpanded, setDeveloperNoteExpanded] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameDisplayNameModalVisible, setRenameDisplayNameModalVisible] = useState(false);
  const [renameGroupInput, setRenameGroupInput] = useState(group.name);
  const [renameDisplayNameInput, setRenameDisplayNameInput] = useState(user.displayName);
  const [myPostsCollapsed, setMyPostsCollapsed] = useState(true);
  const isAndroidBuild = Platform.OS === "android";

  useEffect(() => {
    setRenameGroupInput(group.name);
  }, [group.name]);

  useEffect(() => {
    setRenameDisplayNameInput(user.displayName);
  }, [user.displayName]);

  const handleOpenUpgradeLegalLink = useCallback((documentId: LegalDocumentId | "apple-eula") => {
    const url = documentId === "apple-eula" ? APPLE_STANDARD_EULA_URL : legalDocumentLinks[documentId];

    void Linking.openURL(url).catch(() => {
      Alert.alert("링크를 열 수 없어요", "잠시 후 다시 시도해 주세요.");
    });
  }, []);

  const handlePurchasePress = async () => {
    const completed = await onPurchaseGrowthPlan();
    if (completed) {
      setUpgradeModalVisible(false);
    }
  };

  const handleRestorePress = async () => {
    const completed = await onRestoreGrowthPlan();
    if (completed) {
      setUpgradeModalVisible(false);
    }
  };

  const handleRenamePress = async () => {
    const completed = await onRenameGroup(renameGroupInput);
    if (completed) {
      setRenameModalVisible(false);
    }
  };

  const handleRenameDisplayNamePress = async () => {
    const completed = await onRenameDisplayName(renameDisplayNameInput);
    if (completed) {
      setRenameDisplayNameModalVisible(false);
    }
  };
  const visibleMyPosts = myPostsCollapsed ? posts.slice(0, 3) : posts;
  const hasMoreMyPosts = posts.length > 3;

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.mineContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => onScrollChange(event.nativeEvent.contentOffset.y)}
      >
      <View style={styles.communitySegmented}>
        <Pressable
          style={[styles.communitySegmentItem, panel === "community" ? styles.communitySegmentItemActive : null]}
          onPress={() => onPanelChange("community")}
        >
          <Text style={[styles.communitySegmentLabel, panel === "community" ? styles.communitySegmentLabelActive : null]}>
            공동체
          </Text>
        </Pressable>
        <Pressable
          style={[styles.communitySegmentItem, panel === "settings" ? styles.communitySegmentItemActive : null]}
          onPress={() => onPanelChange("settings")}
        >
          <Text style={[styles.communitySegmentLabel, panel === "settings" ? styles.communitySegmentLabelActive : null]}>
            설정
          </Text>
        </Pressable>
      </View>

      {panel === "community" ? (
        <>
          <View style={styles.card}>
            <View style={styles.groupTitleRow}>
              <Text style={styles.sectionTitle}>{group.name}</Text>
              {user.role === "owner" ? (
                <Pressable
                  style={({ pressed }) => [styles.groupNameEditButton, pressed ? styles.groupNameEditButtonPressed : null]}
                  onPress={() => setRenameModalVisible(true)}
                >
                  <Ionicons name="create-outline" size={15} color={theme.colors.accentPrimary} />
                  <Text style={styles.groupNameEditLabel}>이름 변경</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.sectionDescription}>그룹에 가입하기 위한 초대 코드예요.</Text>
            <View style={styles.groupStatsRow}>
              <StatBox label="초대 코드" value={group.inviteCode} />
              <StatBox label="멤버 수" value={`${group.memberCount}/${group.maxMembers}`} />
            </View>
            <View style={styles.groupActionRow}>
              <Pressable style={styles.groupActionButton} onPress={onCopyInviteCode}>
                <Ionicons name="copy-outline" size={16} color={theme.colors.textPrimary} />
                <Text style={styles.groupActionLabel}>초대 코드 복사</Text>
              </Pressable>
              {user.role === "owner" ? (
                <Pressable style={styles.groupActionButton} onPress={onRegenerateInviteCode}>
                  <Ionicons name="refresh-outline" size={16} color={theme.colors.textPrimary} />
                  <Text style={styles.groupActionLabel}>
                    {groupBusy === "regen" ? "새 코드 만드는 중..." : "초대 코드 재생성"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.groupActionHint}>
              남은 자리 {Math.max(0, group.maxMembers - group.memberCount)}명. 같은 초대 코드로{"\n"}
              최대 {group.maxMembers}명까지 함께할 수 있어요.
            </Text>
            <Text style={styles.memberNamesLabel}>현재 멤버</Text>
            <View style={styles.memberChipWrap}>
              {group.memberNames.map((memberName, index) => {
                const isCurrentUser = memberName === user.displayName;

                return (
                  <View
                    key={`${memberName}-${index}`}
                    style={[styles.memberChip, isCurrentUser ? styles.memberChipCurrent : null]}
                  >
                    <Text style={[styles.memberChipText, isCurrentUser ? styles.memberChipTextCurrent : null]}>
                      {isCurrentUser ? `${memberName} (나)` : memberName}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.planCardHeader}>
              <View style={[styles.planTierBadge, group.subscriptionTier === "growth" ? styles.planTierBadgeGrowth : null]}>
                <Text style={[styles.planTierBadgeText, group.subscriptionTier === "growth" ? styles.planTierBadgeTextGrowth : null]}>
                  {group.subscriptionTier === "growth" ? "확장 플랜" : "무료 플랜"}
                </Text>
              </View>
              <Text style={styles.planLimitText}>최대 {group.maxMembers}명</Text>
            </View>
            <Text style={styles.sectionTitle}>함께하는 인원 확장</Text>
            <Text style={styles.sectionDescription}>
              {isAndroidBuild
                ? "안드로이드 공동체 확장 기능은 차후에 진행할 기능입니다."
                : group.subscriptionTier === "growth"
                ? "지금은 8명 이상 함께할 수 있는 확장 플랜을 사용 중이에요."
                : "기본은 7명까지 함께할 수 있고, 8명 이상으로 확장하려면 구독 결제가 필요해요."}
            </Text>
            {group.subscriptionTier === "free" && user.role === "owner" ? (
              <PrimaryButton
                label={isAndroidBuild ? "차후에 진행할 기능입니다" : "8명 이상 함께하기"}
                onPress={() => setUpgradeModalVisible(true)}
              />
            ) : null}
            {group.subscriptionTier === "free" && user.role !== "owner" ? (
              <Text style={styles.planHelperText}>
                {isAndroidBuild
                  ? "안드로이드에서는 공동체 확장 기능이 아직 준비 중입니다."
                  : "그룹 오너가 확장 플랜을 구독하면 최대 20명까지 함께할 수 있어요."}
              </Text>
            ) : null}
            {group.subscriptionTier === "growth" ? (
              <Text style={styles.planHelperText}>지금은 최대 20명까지 초대할 수 있도록 공동체가 넓어져 있어요.</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <View style={styles.foldSectionHeader}>
              <View style={styles.foldSectionCopy}>
                <Text style={styles.sectionTitle}>내가 올린 사진</Text>
                <Text style={styles.sectionDescription}>지금까지 {posts.length}장의 사진을 올렸어요.</Text>
              </View>
            </View>
          </View>

          {posts.length > 0 ? (
            <>
              {visibleMyPosts.map((post) => (
                <View key={post.id} style={styles.myPostRow}>
                  <View style={styles.myPostThumb}>
                    {post.imageUri ? (
                      <Image source={{ uri: post.imageUri }} style={styles.myPostThumbImage} contentFit="cover" />
                    ) : (
                      <MockPhotoArt palette={post.palette ?? ["#E8C27A", "#D48F5D", "#F8EFE0"]} />
                    )}
                  </View>
                  <View style={styles.myPostMeta}>
                    <Text style={styles.myPostCaption} numberOfLines={2}>
                      {post.caption}
                    </Text>
                    <Text style={styles.myPostDate}>{post.createdLabel}</Text>
                  </View>
                  <Pressable style={styles.deleteButton} onPress={() => onDeletePress(post.id)}>
                    <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                  </Pressable>
                </View>
              ))}
              {hasMoreMyPosts ? (
                <Pressable
                  style={({ pressed }) => [styles.foldToggleFooter, pressed ? styles.foldToggleButtonPressed : null]}
                  onPress={() => setMyPostsCollapsed((current) => !current)}
                >
                  <Text style={styles.foldToggleLabel}>{myPostsCollapsed ? "펼쳐서 더 보기" : "접기"}</Text>
                  <Ionicons
                    name={myPostsCollapsed ? "chevron-down" : "chevron-up"}
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>프로필</Text>
            <Text style={styles.sectionDescription}>공동체와 피드에서 보이는 이름이에요.</Text>
            <View style={styles.profileInfoRow}>
              <View style={styles.profileInfoCopy}>
                <Text style={styles.profileInfoLabel}>현재 이름</Text>
                <Text style={styles.profileInfoValue}>{user.displayName}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.groupNameEditButton, pressed ? styles.groupNameEditButtonPressed : null]}
                onPress={() => setRenameDisplayNameModalVisible(true)}
              >
                <Ionicons name="create-outline" size={15} color={theme.colors.accentPrimary} />
                <Text style={styles.groupNameEditLabel}>이름 변경</Text>
              </Pressable>
            </View>
          </View>

          <NotificationSettingsSection
            settings={user.notificationSettings}
            busy={notificationBusy}
            onToggleDailyReminder={onToggleDailyReminder}
            onChangeReminderTime={onChangeReminderTime}
            onToggleGroupPostNotifications={onToggleGroupPostNotifications}
            onOpenLegalInfoPage={onOpenLegalInfoPage}
          />

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>계정 관리</Text>
            <Text style={styles.sectionDescription}>
              회원 탈퇴 시 계정 정보와 내가 올린 게시물이 함께 삭제되고 복구할 수 없어요.
            </Text>
            <Pressable style={styles.leaveGroupButton} onPress={onDeleteAccount}>
              <Ionicons name="person-remove-outline" size={16} color={theme.colors.danger} />
              <Text style={styles.leaveGroupButtonLabel}>{accountBusy ? "회원 탈퇴 처리 중..." : "회원 탈퇴"}</Text>
            </Pressable>
          </View>
        </>
      )}

      <Pressable style={styles.leaveGroupButton} onPress={onLeaveGroup}>
        <Ionicons name="exit-outline" size={16} color={theme.colors.danger} />
        <Text style={styles.leaveGroupButtonLabel}>
          {groupBusy === "leave"
            ? "그룹에서 나가는 중..."
            : user.role === "owner" && group.memberCount <= 1
              ? "그룹 정리하고 나가기"
              : "그룹 나가기"}
        </Text>
      </Pressable>

      <Pressable style={styles.signOutTextButton} onPress={onSignOut}>
        <Text style={styles.signOutTextLabel}>로그아웃</Text>
      </Pressable>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={upgradeModalVisible}
        onRequestClose={() => {
          setUpgradeModalVisible(false);
          setDeveloperNoteExpanded(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.upgradeModalCard}>
            <View style={styles.upgradeModalHeader}>
              <Text style={styles.modalTitle}>
                {isAndroidBuild ? "공동체 확장 기능은 준비 중이에요" : "공동체를 더 넓게 열어볼까요?"}
              </Text>
              <Text style={styles.modalDescription}>
                {isAndroidBuild
                  ? "안드로이드에서는 공동체 확장 기능을 차후에 진행할 예정입니다."
                  : "무료 플랜은 최대 7명까지, 확장 플랜은 최대 20명까지 함께할 수 있어요."}
              </Text>
            </View>
            <ScrollView
              style={styles.upgradeModalBody}
              contentContainerStyle={styles.upgradeModalBodyContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              bounces={false}
            >
              {!isAndroidBuild ? (
                <>
                  <View style={styles.upgradeFeatureList}>
                    <Text style={styles.upgradeFeatureItem}>서비스: 오늘은혜 공동체 확장 플랜</Text>
                    <Text style={styles.upgradeFeatureItem}>제공 내용: 공동체 최대 20명, 사진/말씀/중보기도 나눔</Text>
                    <Text style={styles.upgradeFeatureItem}>무료 플랜: 최대 7명</Text>
                    <Text style={styles.upgradeFeatureItem}>확장 플랜: 최대 20명</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.upgradeDeveloperToggle,
                      pressed ? styles.foldToggleButtonPressed : null,
                    ]}
                    onPress={() => setDeveloperNoteExpanded((current) => !current)}
                  >
                    <Text style={styles.upgradeDeveloperToggleLabel}>개발팀 인사 펼쳐보기</Text>
                    <Ionicons
                      name={developerNoteExpanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                  {developerNoteExpanded ? (
                    <ScrollView
                      style={styles.upgradeDeveloperNote}
                      contentContainerStyle={styles.upgradeDeveloperNoteContent}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                    >
                      <Text style={styles.upgradeDeveloperNoteText}>
                        안녕하세요, 오늘은혜 개발팀입니다.
                        {"\n\n"}
                        오늘은혜는 주일에만 머무르던 은혜의 나눔이 일주일의 삶 속에서도 자연스럽게 이어지기를 바라는 마음으로 시작되었습니다.
                        {"\n"}
                        일상 속에서의 작은 감사와 묵상이 모여, 우리가 더욱 주님의 은혜를 깊이 누릴 수 있기를 소망합니다.
                        {"\n\n"}
                        누구보다도 많은 성도님들께 이 공간이 닿기를 바라지만, 서버 운영 및 유지 비용으로 인해 부득이하게 8인 이상의 공동체부터는 유료 플랜이 적용됩니다.
                        {"\n\n"}
                        이 공간이 계속해서 따뜻하게 이어질 수 있도록 함께 동역해주시면 진심으로 감사드리겠습니다.
                      </Text>
                    </ScrollView>
                  ) : null}
                </>
              ) : null}
              {upgradeRefreshing ? (
                <View style={styles.upgradeLoadingState}>
                  <ActivityIndicator color={theme.colors.accentPrimary} />
                  <Text style={styles.upgradeLoadingText}>구독 정보를 확인하는 중이에요.</Text>
                </View>
              ) : null}
              {!isAndroidBuild && groupUpgradeState.offer ? (
                <View style={styles.upgradeOfferCard}>
                  <Text style={styles.upgradeOfferEyebrow}>현재 제안된 플랜</Text>
                  <Text style={styles.upgradeOfferTitle}>{groupUpgradeState.offer.title || "오늘은혜 공동체 확장 플랜"}</Text>
                  <View style={styles.upgradeOfferMetaList}>
                    <View style={styles.upgradeOfferMetaRow}>
                      <Text style={styles.upgradeOfferMetaLabel}>구독 기간</Text>
                      <Text style={styles.upgradeOfferMetaValue}>
                        {getUpgradeServicePeriodLabel(groupUpgradeState.offer.periodLabel)}
                      </Text>
                    </View>
                    <View style={styles.upgradeOfferMetaRow}>
                      <Text style={styles.upgradeOfferMetaLabel}>가격</Text>
                      <Text style={styles.upgradeOfferMetaValue}>
                        {groupUpgradeState.offer.priceLabel} / {groupUpgradeState.offer.periodLabel === "월간 구독" ? "월" : "구독 주기"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.upgradeOfferPrice}>{getUpgradeServiceDescription(groupUpgradeState.offer.periodLabel)}</Text>
                </View>
              ) : null}
              {groupUpgradeState.message ? (
                <View style={styles.upgradeStatusBox}>
                  <Text style={styles.upgradeStatusText}>{groupUpgradeState.message}</Text>
                </View>
              ) : null}
              {!isAndroidBuild ? (
                <View style={styles.upgradeLegalCard}>
                  <Text style={styles.upgradeLegalTitle}>약관 및 정책</Text>
                  <View style={styles.upgradeLegalLinkRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.upgradeLegalLinkButton,
                        pressed ? styles.foldToggleButtonPressed : null,
                      ]}
                      onPress={() => handleOpenUpgradeLegalLink("terms")}
                    >
                      <Text style={styles.upgradeLegalLinkLabel}>이용약관</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.upgradeLegalLinkButton,
                        pressed ? styles.foldToggleButtonPressed : null,
                      ]}
                      onPress={() => handleOpenUpgradeLegalLink("privacy")}
                    >
                      <Text style={styles.upgradeLegalLinkLabel}>개인정보 정책</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.upgradeLegalLinkButtonWide,
                      pressed ? styles.foldToggleButtonPressed : null,
                    ]}
                    onPress={() => handleOpenUpgradeLegalLink("apple-eula")}
                  >
                    <Text style={styles.upgradeLegalLinkLabel}>Apple 표준 사용 약관(EULA)</Text>
                  </Pressable>
                </View>
              ) : null}
              {!isAndroidBuild ? (
                <View style={styles.upgradeSubscriptionNotice}>
                  <Text style={styles.upgradeSubscriptionNoticeText}>
                    확장 플랜은 1개월 단위 자동 갱신 구독입니다. 해지 및 환불은 Apple 정책을 따르며, 이미 구매한 구독은 복원할 수 있어요.
                  </Text>
                </View>
              ) : null}
              {groupUpgradeState.entitlementActive ? (
                <View style={styles.upgradeActiveBox}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.colors.accentPrimary} />
                  <Text style={styles.upgradeActiveText}>이미 확장 플랜이 연결되어 있어요.</Text>
                </View>
              ) : null}
            </ScrollView>
            <View style={styles.upgradeModalFooter}>
              <View style={styles.upgradeModalActions}>
                <SecondaryButton
                  label="나중에 할게요"
                  onPress={() => {
                    setUpgradeModalVisible(false);
                    setDeveloperNoteExpanded(false);
                  }}
                />
                {user.role === "owner" && groupUpgradeState.supported && groupUpgradeState.configured ? (
                  <SecondaryButton
                    label={upgradeActionBusy === "restore" ? "복원하는 중..." : "구독 복원"}
                    onPress={() => {
                      void handleRestorePress();
                    }}
                  />
                ) : null}
                {user.role === "owner" && !groupUpgradeState.entitlementActive && groupUpgradeState.offer ? (
                  <PrimaryButton
                    label={upgradeActionBusy === "purchase" ? "결제창 여는 중..." : "확장 플랜 구독하기"}
                    onPress={() => {
                      void handlePurchasePress();
                    }}
                  />
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={renameModalVisible}
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>그룹 이름 바꾸기</Text>
            <Text style={styles.modalDescription}>그룹 생성자만 공동체 이름을 바꿀 수 있어요.</Text>
            <TextInput
              value={renameGroupInput}
              onChangeText={setRenameGroupInput}
              placeholder="예: 청년부 사진 공동체"
              placeholderTextColor={theme.colors.textTertiary}
              style={styles.textField}
              autoFocus
            />
            <View style={styles.modalActions}>
              <SecondaryButton
                label="취소"
                onPress={() => {
                  setRenameModalVisible(false);
                  setRenameGroupInput(group.name);
                }}
              />
              <PrimaryButton
                compact
                label={groupBusy === "rename" ? "바꾸는 중..." : "이 이름으로 변경"}
                onPress={() => {
                  void handleRenamePress();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={renameDisplayNameModalVisible}
        onRequestClose={() => setRenameDisplayNameModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>이름 변경</Text>
            <Text style={styles.modalDescription}>공동체와 피드에 보여지는 이름을 바꿀 수 있어요.</Text>
            <TextInput
              value={renameDisplayNameInput}
              onChangeText={setRenameDisplayNameInput}
              placeholder="예: 김은혜"
              placeholderTextColor={theme.colors.textTertiary}
              style={styles.textField}
              autoFocus
            />
            <View style={styles.modalActionsStacked}>
              <PrimaryButton
                label={displayNameBusy ? "저장 중..." : "저장하기"}
                disabled={displayNameBusy}
                onPress={() => {
                  void handleRenameDisplayNamePress();
                }}
              />
              <SecondaryButton
                label="취소"
                onPress={() => {
                  setRenameDisplayNameModalVisible(false);
                  setRenameDisplayNameInput(user.displayName);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ConsentChecklistCard({
  consentDraft,
  onToggle,
  onOpenDocument,
}: {
  consentDraft: {
    terms: boolean;
    privacy: boolean;
    community: boolean;
  };
  onToggle: (consentId: "terms" | "privacy" | "community") => void;
  onOpenDocument: (documentId: LegalDocumentId) => void;
}) {
  return (
    <View style={styles.legalConsentCard}>
      <View style={styles.legalConsentList}>
        {requiredConsentItems.map((item) => {
          const checked = consentDraft[item.id];

          return (
            <View key={item.id} style={styles.legalConsentRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.legalConsentToggleArea,
                  pressed ? styles.foldToggleButtonPressed : null,
                ]}
                onPress={() => onToggle(item.id)}
                hitSlop={8}
              >
                <View style={styles.legalConsentCheckHit}>
                  <Ionicons
                    name={checked ? "checkbox" : "square-outline"}
                    size={24}
                    color={checked ? theme.colors.accentPrimary : theme.colors.textTertiary}
                  />
                </View>
                <Text style={styles.legalConsentLabel}>{item.label}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.legalConsentViewButton,
                  pressed ? styles.foldToggleButtonPressed : null,
                ]}
                onPress={() => onOpenDocument(item.documentId)}
                hitSlop={8}
              >
                <Text style={styles.legalConsentViewLabel}>보기</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function LegalInfoPage({
  initialDocumentId,
  onClose,
}: {
  initialDocumentId: LegalDocumentId | null;
  onClose: () => void;
}) {
  const [expandedDocumentId, setExpandedDocumentId] = useState<LegalDocumentId | null>(initialDocumentId ?? "terms");

  useEffect(() => {
    setExpandedDocumentId(initialDocumentId ?? "terms");
  }, [initialDocumentId]);

  const currentDocument = legalDocuments.find((document) => document.id === (expandedDocumentId ?? "terms"));

  return (
    <SafeAreaView style={styles.legalInfoPage}>
      <View style={styles.legalInfoHeader}>
        <Pressable style={styles.legalInfoBackButton} onPress={onClose} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.legalInfoHeaderCopy}>
          <Text style={styles.legalInfoTitle}>{currentDocument?.title ?? "이용약관"}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.legalInfoContent}
        showsVerticalScrollIndicator={false}
      >
        {legalDocuments.map((document) => {
          const expanded = expandedDocumentId === document.id;

          return (
            <View key={document.id} style={styles.legalInfoSectionCard}>
              <Pressable
                style={({ pressed }) => [
                  styles.legalInfoSectionHeader,
                  pressed ? styles.foldToggleButtonPressed : null,
                ]}
                onPress={() => setExpandedDocumentId((current) => (current === document.id ? null : document.id))}
              >
                <View style={styles.legalInfoSectionHeaderCopy}>
                  <Text style={styles.legalInfoSectionTitle}>{document.title}</Text>
                  <Text style={styles.legalInfoSectionMeta}>{document.updatedAt}</Text>
                </View>
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={theme.colors.textSecondary}
                />
              </Pressable>

              {expanded ? (
                <View style={styles.legalInfoSectionBody}>
                  <Text style={styles.legalInfoSummary}>{document.summary}</Text>
                  {document.sections.map((section) => (
                    <View key={section.heading} style={styles.legalInfoParagraphBlock}>
                      <Text style={styles.legalInfoParagraphTitle}>{section.heading}</Text>
                      {section.body.map((paragraph, index) => (
                        <Text key={`${section.heading}-${index}`} style={styles.legalInfoParagraph}>
                          {paragraph}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>성경 본문 안내</Text>
          <Text style={styles.sectionDescription}>
            오늘 은혜의 성경 본문은 대한성서공회 성경읽기 개역한글판(HAN)을 기준으로 표기합니다.
          </Text>
          <Text style={styles.settingFootnote}>성경전서 개역한글판 © 대한성서공회 1961.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>문의</Text>
          <Text style={styles.sectionDescription}>
            서비스 운영, 게시물 신고, 개인정보 관련 문의는 아래 메일로 보내 주세요.
          </Text>
          <Text style={styles.settingFootnote}>iworkouttoday@gmail.com</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationSettingsSection({
  settings,
  busy,
  onToggleDailyReminder,
  onChangeReminderTime,
  onToggleGroupPostNotifications,
  onOpenLegalInfoPage,
}: {
  settings: NotificationSettings;
  busy: "daily" | "group-post" | null;
  onToggleDailyReminder: (enabled: boolean) => void;
  onChangeReminderTime: (hour: number, minute: number) => void;
  onToggleGroupPostNotifications: (enabled: boolean) => void;
  onOpenLegalInfoPage: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>알림 설정</Text>
      <Text style={styles.sectionDescription}>리마인더와 공동체 알림을 따로 켜고 끌 수 있어요.</Text>

      <SettingRow
        title="오늘의 은혜 리마인더"
        description={
          settings.dailyReminderEnabled
            ? `${formatReminderTime(settings.reminderHour, settings.reminderMinute)}에 오늘의 은혜를 공유하실 시간입니다 알림을 보내드려요.`
            : "원하는 시간에 매일 한 번 은혜를 올릴 시간을 알려드려요."
        }
        value={settings.dailyReminderEnabled}
        disabled={busy === "daily"}
        onValueChange={onToggleDailyReminder}
      />

      <View style={styles.reminderTimeCard}>
        <Text style={styles.reminderTimeTitle}>알림 시간</Text>
        <Text style={styles.reminderTimeCurrent}>{formatReminderTime(settings.reminderHour, settings.reminderMinute)}</Text>
        <View style={styles.reminderTimeOptionWrap}>
          {REMINDER_TIME_OPTIONS.map((option) => {
            const isSelected =
              option.hour === settings.reminderHour && option.minute === settings.reminderMinute;

            return (
              <Pressable
                key={option.label}
                style={[
                  styles.reminderTimeOption,
                  isSelected ? styles.reminderTimeOptionActive : null,
                  !settings.dailyReminderEnabled ? styles.reminderTimeOptionDisabled : null,
                ]}
                disabled={!settings.dailyReminderEnabled || busy === "daily"}
                onPress={() => onChangeReminderTime(option.hour, option.minute)}
              >
                <Text
                  style={[
                    styles.reminderTimeOptionLabel,
                    isSelected ? styles.reminderTimeOptionLabelActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SettingRow
        title="공동체 소식 알림"
        description="멤버 글 공유와 중보기도 순번, 오늘 함께 기도할 제목 알림을 보내드려요."
        value={settings.groupPostEnabled}
        disabled={busy === "group-post"}
        onValueChange={onToggleGroupPostNotifications}
      />

      <Pressable
        style={({ pressed }) => [styles.settingLinkRow, pressed ? styles.foldToggleButtonPressed : null]}
        onPress={onOpenLegalInfoPage}
      >
        <View style={styles.settingCopy}>
          <Text style={styles.settingTitle}>서비스 정보</Text>
          <Text style={styles.settingDescription}>이용약관, 개인정보 정책, 커뮤니티 가이드라인을 앱 안에서 확인해 보세요.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function SettingRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: "rgba(120, 102, 78, 0.18)", true: "rgba(216, 160, 91, 0.34)" }}
        thumbColor={value ? theme.colors.accentPrimary : "#FFFFFF"}
        ios_backgroundColor="rgba(120, 102, 78, 0.18)"
      />
    </View>
  );
}

function ReminderPromptModal({
  selectedHour,
  selectedMinute,
  busy,
  onSelect,
  onLater,
  onConfirm,
}: {
  selectedHour: number;
  selectedMinute: number;
  busy: boolean;
  onSelect: (hour: number, minute: number) => void;
  onLater: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>몇시에 은혜를 올릴 알람을 드릴까요?</Text>
        <Text style={styles.modalDescription}>
          고른 시간에 맞춰 오늘의 은혜를 공유하실 시간입니다 알림을 보내드릴게요.
        </Text>
        <View style={styles.reminderPromptOptions}>
          {REMINDER_TIME_OPTIONS.map((option) => {
            const isSelected = option.hour === selectedHour && option.minute === selectedMinute;

            return (
              <Pressable
                key={`prompt-${option.label}`}
                style={[
                  styles.reminderPromptOption,
                  isSelected ? styles.reminderPromptOptionActive : null,
                ]}
                onPress={() => onSelect(option.hour, option.minute)}
              >
                <Text
                  style={[
                    styles.reminderPromptOptionLabel,
                    isSelected ? styles.reminderPromptOptionLabelActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.reminderPromptActions}>
          <SecondaryButton label="나중에 할게요" onPress={onLater} />
          <PrimaryButton compact label={busy ? "설정하는 중..." : "이 시간으로 받을래요"} onPress={onConfirm} />
        </View>
      </View>
    </View>
  );
}

function PhotoCard({
  post,
  uploading,
  showMenu,
  isMyPost,
  onMorePress,
  onRevealHintSeen,
}: {
  post: GracePost;
  uploading?: boolean;
  showMenu?: boolean;
  isMyPost?: boolean;
  onMorePress?: () => void;
  onRevealHintSeen?: () => void;
}) {
  const [isRevealingPhoto, setIsRevealingPhoto] = useState(false);

  return (
    <View style={styles.photoCard}>
      <View style={styles.photoMediaWrap}>
        <Pressable
          style={styles.photoTapArea}
          delayLongPress={180}
          onLongPress={() => {
            setIsRevealingPhoto(true);
            onRevealHintSeen?.();
          }}
          onPressOut={() => setIsRevealingPhoto(false)}
        >
          {post.imageUri ? (
            <Image source={{ uri: post.imageUri }} style={styles.cardImage} contentFit="cover" transition={180} />
          ) : (
            <MockPhotoArt palette={post.palette ?? ["#E8C27A", "#D48F5D", "#F8EFE0"]} />
          )}
          {post.verseText && !isRevealingPhoto ? (
            <VerseOverlay text={post.verseText} reference={post.verseReference} />
          ) : null}
        </Pressable>
        {showMenu ? (
          <Pressable style={styles.cardMenuFloatingButton} onPress={onMorePress}>
            <Ionicons
              name={isMyPost ? "ellipsis-horizontal-circle-outline" : "ellipsis-horizontal"}
              size={15}
              color="rgba(59, 43, 35, 0.78)"
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.cardMetaRow}>
          <View style={styles.cardMetaPrimary}>
            <Text style={styles.cardAuthor}>{post.authorName}</Text>
            <Text style={styles.cardGroup}>{post.groupName}</Text>
          </View>
          <View style={styles.cardMetaTrailing}>
            {uploading ? (
              <View style={styles.cardUploadingBadge}>
                <ActivityIndicator size="small" color={theme.colors.accentPrimary} />
                <Text style={styles.cardUploadingText}>업로드 중</Text>
              </View>
            ) : (
              <Text style={styles.cardDate}>{post.createdLabel}</Text>
            )}
          </View>
        </View>
        <Text style={styles.cardCaption}>{post.caption}</Text>
      </View>
    </View>
  );
}

function VerseOverlay({
  text,
  reference,
  preview,
}: {
  text: string;
  reference?: string;
  preview?: boolean;
}) {
  return (
    <View style={[styles.verseOverlay, preview ? styles.verseOverlayPreview : null]}>
      <View style={styles.verseOverlayScrim} />
      <View style={styles.verseOverlayInner}>
        <WrappedVerseText text={text} preview={preview} />
        {reference ? (
          <Text
            style={[styles.verseReference, preview ? styles.verseReferencePreview : null]}
            numberOfLines={1}
          >
            {reference}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function WrappedVerseText({ text, preview }: { text: string; preview?: boolean }) {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    <View style={styles.verseWordsWrap}>
      {words.map((word, index) => (
        <Text key={`${word}-${index}`} style={[styles.verseWord, preview ? styles.verseWordPreview : null]}>
          {word}
        </Text>
      ))}
    </View>
  );
}

function VerseCollectionModal({
  items,
  currentMonthLabel,
  onClose,
}: {
  items: {
    id: string;
    text: string;
    reference?: string;
    authorName: string;
    createdLabel: string;
  }[];
  currentMonthLabel: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.collectionModalCard}>
        <View style={styles.collectionModalHeader}>
          <View style={styles.collectionModalTitleBlock}>
            <Text style={styles.collectionModalEyebrow}>이번 달</Text>
            <Text style={styles.collectionModalTitle}>{currentMonthLabel}에 쌓은 말씀</Text>
            <Text style={styles.collectionModalDescription}>이번 달 사진과 함께 기록된 말씀들을 한곳에 모아봤어요.</Text>
          </View>
          <Pressable style={styles.collectionModalClose} onPress={onClose}>
            <Ionicons name="close" size={18} color={theme.colors.textPrimary} />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <View style={styles.collectionModalEmpty}>
            <Text style={styles.emptyTitle}>아직 모인 말씀이 없어요</Text>
            <Text style={styles.emptyDescription}>사진이 쌓이면 여기에도 하나씩 기록돼요.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.collectionList}>
            {items.map((item, index) => (
              <View key={item.id} style={styles.collectionListItem}>
                <View style={styles.collectionListBadge}>
                  <Text style={styles.collectionListBadgeText}>{index + 1}</Text>
                </View>
                <View style={styles.collectionListCopy}>
                  <Text style={styles.collectionListVerse}>{item.text}</Text>
                  {item.reference ? (
                    <Text style={styles.collectionListReference}>{item.reference}</Text>
                  ) : null}
                  <Text style={styles.collectionListMeta}>
                    {item.authorName} · {item.createdLabel}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function MockPhotoArt({ palette }: { palette: [string, string, string] }) {
  return (
    <View style={[styles.mockPhoto, { backgroundColor: palette[2] }]}>
      <View style={[styles.mockPhotoCircle, { backgroundColor: palette[0] }]} />
      <View style={[styles.mockPhotoBlob, { backgroundColor: palette[1] }]} />
      <View style={styles.mockPhotoFooter}>
        <Text style={styles.mockPhotoLabel}>grace moment</Text>
      </View>
    </View>
  );
}

function BottomTabs({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (next: TabKey) => void;
}) {
  return (
    <View style={styles.tabBarShell}>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable key={tab.key} style={[styles.tabItem, isActive ? styles.tabItemActive : null]} onPress={() => onChange(tab.key)}>
              <Ionicons
                name={isActive ? (tab.icon.replace("-outline", "") as keyof typeof Ionicons.glyphMap) : tab.icon}
                size={20}
                color={isActive ? theme.colors.accentPrimary : theme.colors.textTertiary}
              />
              <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function LabeledField({
  label,
  value,
  placeholder,
  onChangeText,
  autoCapitalize,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        style={styles.textField}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  compact,
  disabled,
}: {
  label: string;
  onPress: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        compact ? styles.compactButton : null,
        disabled ? styles.primaryButtonDisabled : null,
        pressed && !disabled ? styles.primaryButtonPressed : null,
      ]}
    >
      <Text style={styles.primaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled ? styles.secondaryButtonDisabled : null,
        pressed && !disabled ? styles.secondaryPressed : null,
      ]}
    >
      <Text style={styles.secondaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function AppBackground() {
  return (
    <View pointerEvents="none" style={styles.backgroundLayer}>
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
    </View>
  );
}

function BrandSplash({ copy, overlay }: { copy: string; overlay?: boolean }) {
  return (
    <View style={[styles.brandSplashWrap, overlay ? styles.brandSplashOverlay : null]}>
      <View style={styles.brandSplashContent}>
        <Text style={styles.brandSplashEyebrow}>Today Grace Community</Text>
        <Text style={styles.brandSplashTitle}>오늘 은혜</Text>
        <Text style={styles.brandSplashCopy}>{copy}</Text>
        <View style={styles.brandSplashLoaderRow}>
          <ActivityIndicator color={theme.colors.accentPrimary} />
          <Text style={styles.brandSplashLoaderText}>잠시만 기다려 주세요</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  backgroundGlowTop: {
    position: "absolute",
    top: -80,
    alignSelf: "center",
    width: 320,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(228, 198, 122, 0.18)",
  },
  backgroundGlowBottom: {
    position: "absolute",
    bottom: -100,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(216, 154, 91, 0.10)",
  },
  onboardingScroll: {
    padding: theme.spacing.xl,
    gap: theme.spacing.xl,
    paddingBottom: theme.spacing.xxxl,
  },
  onboardingKeyboard: {
    flex: 1,
  },
  heroPanel: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.xxl,
  },
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: theme.colors.textPrimary,
    fontSize: 42,
    lineHeight: 48,
    fontFamily: theme.fonts.display,
  },
  heroSubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
  },
  appleButton: {
    width: "100%",
    height: 52,
    marginBottom: theme.spacing.md,
  },
  authButtonDisabled: {
    opacity: 0.48,
  },
  authConsentHint: {
    marginTop: theme.spacing.sm,
    color: theme.colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  kakaoButton: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    backgroundColor: "#FEE500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  kakaoButtonPressed: {
    opacity: 0.9,
  },
  kakaoButtonLabel: {
    color: "#3C1E1E",
    fontSize: 16,
    fontWeight: "700",
  },
  unavailableCard: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: theme.spacing.md,
  },
  unavailableText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  redirectText: {
    marginTop: 6,
    color: theme.colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
  },
  appShell: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: Platform.select({ ios: theme.spacing.sm, android: theme.spacing.md, default: theme.spacing.sm }),
    paddingBottom: theme.spacing.md,
  },
  headerShell: {
    overflow: "hidden",
  },
  header: {
    gap: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  headerBrand: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    lineHeight: 36,
    fontFamily: theme.fonts.display,
    flexShrink: 1,
  },
  headerCopy: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  collectionIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  collectionIconButtonPressed: {
    opacity: 0.82,
  },
  collectionIconStack: {
    width: 28,
    height: 28,
    position: "relative",
  },
  collectionIconBackFar: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 22,
    height: 22,
    borderRadius: 10,
    backgroundColor: "rgba(228, 198, 122, 0.32)",
    borderWidth: 1,
    borderColor: "rgba(193, 147, 72, 0.18)",
  },
  collectionIconBackNear: {
    position: "absolute",
    top: 5,
    left: 5,
    width: 22,
    height: 22,
    borderRadius: 10,
    backgroundColor: "rgba(228, 198, 122, 0.48)",
    borderWidth: 1,
    borderColor: "rgba(193, 147, 72, 0.20)",
  },
  collectionIconFront: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  contentArea: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: theme.spacing.xl,
  },
  centerStateText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
  },
  brandSplashWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  brandSplashOverlay: {
    backgroundColor: "rgba(248, 244, 234, 0.96)",
  },
  brandSplashContent: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: theme.spacing.md,
  },
  brandSplashEyebrow: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandSplashTitle: {
    color: theme.colors.textPrimary,
    fontSize: 44,
    lineHeight: 50,
    fontFamily: theme.fonts.display,
  },
  brandSplashCopy: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 25,
    textAlign: "center",
  },
  brandSplashLoaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  brandSplashLoaderText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    ...theme.shadow.card,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    marginBottom: theme.spacing.sm,
  },
  sectionDescription: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: theme.spacing.lg,
  },
  fieldBlock: {
    marginBottom: theme.spacing.lg,
  },
  fieldLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: theme.spacing.sm,
  },
  textField: {
    minHeight: 54,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    paddingHorizontal: 14,
    color: theme.colors.textPrimary,
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    backgroundColor: theme.colors.accentPrimary,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  legalConsentCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    gap: theme.spacing.xs,
  },
  legalConsentList: {
    gap: theme.spacing.sm,
  },
  legalConsentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  legalConsentToggleArea: {
    flex: 1,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: 6,
    paddingRight: 4,
    borderRadius: theme.radius.md,
  },
  legalConsentCheckHit: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  legalConsentLabel: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  legalConsentViewButton: {
    minWidth: 62,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
    alignItems: "center",
    justifyContent: "center",
  },
  legalConsentViewLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  legalConsentCompleteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  legalConsentCompleteText: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  legalGateShell: {
    flex: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  legalGateHeader: {
    gap: theme.spacing.sm,
  },
  legalGateTitle: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -1,
  },
  legalGateDescription: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  legalGateBody: {
    marginTop: theme.spacing.xl,
  },
  legalGateFooter: {
    marginTop: "auto",
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.lg,
  },
  compactButton: {
    minHeight: 48,
  },
  primaryButtonDisabled: {
    opacity: 0.58,
  },
  primaryButtonPressed: {
    backgroundColor: theme.colors.accentPressed,
  },
  primaryButtonLabel: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryPressed: {
    backgroundColor: theme.colors.accentSoft,
  },
  secondaryButtonDisabled: {
    opacity: 0.5,
  },
  secondaryButtonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  helperText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textTertiary,
    fontSize: 13,
    lineHeight: 20,
  },
  feedContent: {
    paddingBottom: theme.spacing.xxxl,
    gap: theme.spacing.lg,
  },
  prayerFocusCard: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: "rgba(214, 167, 92, 0.24)",
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
    ...theme.shadow.card,
  },
  prayerFocusHeader: {
    gap: theme.spacing.sm,
  },
  prayerFocusHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  prayerFocusTitleBlock: {
    width: "100%",
    gap: 10,
  },
  prayerFocusEyebrow: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  prayerFocusTitle: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 31,
    fontFamily: theme.fonts.display,
  },
  prayerFocusTitleWrap: {
    gap: 2,
  },
  prayerFocusTitleSecondary: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 31,
    fontFamily: theme.fonts.display,
  },
  prayerFocusDescription: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  prayerFocusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(193, 147, 72, 0.18)",
  },
  prayerFocusBadgeText: {
    color: theme.colors.accentPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  prayerFocusPrompt: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    gap: 8,
  },
  prayerFocusPromptEditable: {
    borderColor: "rgba(193, 147, 72, 0.24)",
  },
  prayerFocusPromptPressed: {
    backgroundColor: theme.colors.accentSoft,
  },
  prayerFocusPromptTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  prayerFocusPromptText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  prayerFocusEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  prayerFocusEditText: {
    color: theme.colors.accentPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  prayerFocusRosterScroll: {
    marginHorizontal: -2,
  },
  prayerFocusRoster: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: 2,
  },
  prayerFocusChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  prayerFocusChipToday: {
    borderColor: "rgba(193, 147, 72, 0.38)",
  },
  prayerFocusChipActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentPrimary,
  },
  prayerFocusChipText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  prayerFocusChipTextActive: {
    color: theme.colors.textPrimary,
  },
  feedEmptyStateCard: {
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.xl,
    ...theme.shadow.card,
  },
  feedTipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  feedTipCopy: {
    flex: 1,
    gap: 4,
  },
  feedTipTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  feedTipDescription: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  feedTipClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
  },
  photoCard: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    overflow: "hidden",
    ...theme.shadow.card,
  },
  photoMediaWrap: {
    position: "relative",
  },
  photoTapArea: {
    aspectRatio: 4 / 5,
    backgroundColor: "#EBDCC8",
    justifyContent: "center",
    alignItems: "center",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  verseOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  verseOverlayPreview: {
    paddingHorizontal: theme.spacing.lg,
  },
  verseOverlayScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(34, 28, 20, 0.20)",
  },
  verseOverlayInner: {
    maxWidth: "88%",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255, 249, 240, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 253, 249, 0.34)",
  },
  verseWordsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    columnGap: 6,
    rowGap: 2,
  },
  verseWord: {
    color: theme.colors.white,
    fontSize: 23,
    lineHeight: 33,
    fontFamily: theme.fonts.display,
    textShadowColor: "rgba(34, 28, 20, 0.44)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  verseWordPreview: {
    fontSize: 20,
    lineHeight: 29,
  },
  verseReference: {
    marginTop: 8,
    color: "rgba(255, 247, 237, 0.90)",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  verseReferencePreview: {
    fontSize: 11,
  },
  mockPhoto: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  mockPhotoCircle: {
    position: "absolute",
    top: -16,
    right: -8,
    width: 140,
    height: 140,
    borderRadius: 999,
    opacity: 0.92,
  },
  mockPhotoBlob: {
    position: "absolute",
    bottom: 40,
    left: -28,
    width: 220,
    height: 140,
    borderRadius: 40,
    opacity: 0.82,
    transform: [{ rotate: "-9deg" }],
  },
  mockPhotoFooter: {
    marginTop: "auto",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: "rgba(255, 249, 240, 0.72)",
  },
  mockPhotoLabel: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  cardMeta: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  cardMetaPrimary: {
    flex: 1,
  },
  cardMetaTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  cardAuthor: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  cardGroup: {
    marginTop: 2,
    color: theme.colors.textTertiary,
    fontSize: 13,
  },
  cardDate: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  cardMenuFloatingButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 249, 240, 0.44)",
    borderWidth: 1,
    borderColor: "rgba(255, 249, 240, 0.28)",
    opacity: 0.82,
  },
  cardUploadingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.accentPrimary,
  },
  cardUploadingText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  cardCaption: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 260,
  },
  emptyDescription: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    marginBottom: theme.spacing.sm,
    maxWidth: 250,
  },
  uploadContent: {
    paddingBottom: theme.spacing.xxxl,
  },
  photoPickerArea: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    borderStyle: "dashed",
    backgroundColor: theme.colors.backgroundSecondary,
    alignItems: "center",
    padding: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  photoPickerArtwork: {
    width: 78,
    height: 78,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentSoft,
  },
  photoPickerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: "600",
  },
  photoPickerDescription: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  uploadButtonRow: {
    width: "100%",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  previewWrap: {
    gap: theme.spacing.md,
  },
  previewFrame: {
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: "#E7DDCC",
  },
  previewReplace: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewReplaceText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  captionSection: {
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  scriptureInfoCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  scriptureInfoText: {
    color: theme.colors.textPrimary,
    fontSize: 17,
    lineHeight: 27,
    fontFamily: theme.fonts.display,
  },
  scriptureInfoReference: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  captionInput: {
    minHeight: 108,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  prayerRequestInput: {
    minHeight: 128,
    marginTop: theme.spacing.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 23,
  },
  prayerRequestModalKeyboard: {
    flex: 1,
  },
  prayerRequestModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(46, 42, 36, 0.18)",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  prayerRequestModalCard: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    ...theme.shadow.floating,
  },
  cameraModalShell: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#050505",
    zIndex: 60,
    elevation: 60,
  },
  cameraView: {
    flex: 1,
  },
  cameraPermissionFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    backgroundColor: "#111111",
  },
  cameraPermissionTitle: {
    color: theme.colors.white,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
    textAlign: "center",
  },
  cameraPermissionDescription: {
    marginTop: theme.spacing.md,
    color: "rgba(255, 249, 240, 0.82)",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  cameraGuideLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 108,
    paddingBottom: 168,
  },
  cameraGuideFrame: {
    width: "100%",
    maxWidth: 360,
    aspectRatio: 4 / 5,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(255, 249, 240, 0.82)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },
  },
  cameraGuideBadge: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(17, 17, 17, 0.44)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  cameraGuideBadgeText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  cameraTopBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  cameraBottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  cameraIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(17, 17, 17, 0.46)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  cameraIconButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  cameraSideButton: {
    minWidth: 78,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(17, 17, 17, 0.54)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cameraSideButtonLabel: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  cameraShutterButton: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraShutterButtonPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.88,
  },
  cameraShutterInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: theme.colors.white,
  },
  mineContent: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  communitySegmented: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255, 250, 242, 0.82)",
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  communitySegmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  communitySegmentItemActive: {
    backgroundColor: theme.colors.accentSoft,
  },
  communitySegmentLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  communitySegmentLabelActive: {
    color: theme.colors.textPrimary,
  },
  groupStatsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  statLabel: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
  },
  memberNamesLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  groupTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  groupNameEditButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(193, 147, 72, 0.24)",
  },
  groupNameEditButtonPressed: {
    opacity: 0.82,
  },
  groupNameEditLabel: {
    color: theme.colors.accentPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  profileInfoCopy: {
    flex: 1,
    gap: 4,
  },
  profileInfoLabel: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    fontWeight: "600",
  },
  profileInfoValue: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  groupActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  groupActionButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  groupActionLabel: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  groupActionHint: {
    color: theme.colors.textTertiary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: theme.spacing.lg,
  },
  foldSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  foldSectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  foldToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  foldToggleButtonPressed: {
    opacity: 0.82,
  },
  foldToggleFooter: {
    minHeight: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  foldToggleLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  legalInfoPage: {
    flex: 1,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  legalInfoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  legalInfoBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    zIndex: 2,
  },
  legalInfoHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  legalInfoTitle: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  legalInfoContent: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  legalInfoSectionCard: {
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
    overflow: "hidden",
  },
  legalInfoSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  legalInfoSectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  legalInfoSectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  legalInfoSectionMeta: {
    color: theme.colors.textTertiary,
    fontSize: 12,
  },
  legalInfoSectionBody: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  legalInfoSummary: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },
  legalInfoParagraphBlock: {
    gap: theme.spacing.xs,
  },
  legalInfoParagraphTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  legalInfoParagraph: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  infoDocumentList: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  infoDocumentButton: {
    minHeight: 72,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  infoDocumentCopy: {
    flex: 1,
    gap: 4,
  },
  infoDocumentTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  infoDocumentSummary: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  infoDocumentMeta: {
    color: theme.colors.textTertiary,
    fontSize: 12,
  },
  memberChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  memberChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  memberChipCurrent: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentPrimary,
  },
  memberChipText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  memberChipTextCurrent: {
    color: theme.colors.textPrimary,
  },
  planCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  planTierBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  planTierBadgeGrowth: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentPrimary,
  },
  planTierBadgeText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  planTierBadgeTextGrowth: {
    color: theme.colors.textPrimary,
  },
  planLimitText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  planHelperText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  settingRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.lineSoft,
  },
  settingLinkRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: theme.spacing.md,
    marginTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.lineSoft,
  },
  settingCopy: {
    flex: 1,
    gap: 6,
    paddingRight: theme.spacing.md,
  },
  settingTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  settingDescription: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  reminderTimeCard: {
    marginTop: theme.spacing.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  reminderTimeTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  reminderTimeCurrent: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
  },
  reminderTimeOptionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  reminderTimeOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
  },
  reminderTimeOptionActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentPrimary,
  },
  reminderTimeOptionDisabled: {
    opacity: 0.48,
  },
  reminderTimeOptionLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  reminderTimeOptionLabelActive: {
    color: theme.colors.textPrimary,
  },
  emptyMiniCard: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.xl,
    ...theme.shadow.card,
  },
  myPostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.md,
    ...theme.shadow.card,
  },
  myPostThumb: {
    width: 76,
    height: 96,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#E8DBC7",
  },
  myPostThumbImage: {
    width: "100%",
    height: "100%",
  },
  myPostMeta: {
    flex: 1,
    gap: 6,
  },
  myPostCaption: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  myPostDate: {
    color: theme.colors.textTertiary,
    fontSize: 13,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  leaveGroupButton: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(164, 87, 67, 0.24)",
    backgroundColor: "rgba(164, 87, 67, 0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  leaveGroupButtonLabel: {
    color: theme.colors.danger,
    fontSize: 15,
    fontWeight: "700",
  },
  signOutTextButton: {
    alignSelf: "center",
    paddingVertical: theme.spacing.md,
  },
  signOutTextLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  settingFootnote: {
    marginTop: theme.spacing.md,
    color: theme.colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
  },
  reminderPromptOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  reminderPromptOption: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  reminderPromptOptionActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accentPrimary,
  },
  reminderPromptOptionLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  reminderPromptOptionLabelActive: {
    color: theme.colors.textPrimary,
  },
  reminderPromptActions: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  tabBarShell: {
    paddingTop: theme.spacing.md,
  },
  tabBar: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    backgroundColor: "rgba(255, 249, 240, 0.92)",
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.sm,
    ...theme.shadow.floating,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 58,
    borderRadius: 18,
  },
  tabItemActive: {
    backgroundColor: theme.colors.accentSoft,
  },
  tabLabel: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: theme.colors.accentPrimary,
  },
  collectionModalCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "78%",
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    padding: theme.spacing.xl,
    ...theme.shadow.floating,
  },
  collectionModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  collectionModalTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  collectionModalEyebrow: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
  },
  collectionModalTitle: {
    marginTop: 4,
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    fontFamily: theme.fonts.display,
  },
  collectionModalDescription: {
    marginTop: 8,
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  collectionModalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  collectionModalEmpty: {
    paddingVertical: theme.spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionList: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  collectionListItem: {
    flexDirection: "row",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  collectionListBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentSoft,
  },
  collectionListBadgeText: {
    color: theme.colors.accentPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  collectionListCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  collectionListVerse: {
    color: theme.colors.textPrimary,
    fontSize: 17,
    lineHeight: 26,
    fontFamily: theme.fonts.display,
  },
  collectionListReference: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  collectionListMeta: {
    color: theme.colors.textTertiary,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(46, 42, 36, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    ...theme.shadow.floating,
  },
  upgradeModalCard: {
    width: "100%",
    maxWidth: 340,
    maxHeight: "82%",
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    overflow: "hidden",
    ...theme.shadow.floating,
  },
  upgradeModalHeader: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  upgradeModalBody: {
    flexGrow: 0,
    paddingHorizontal: theme.spacing.xl,
  },
  upgradeModalBodyContent: {
    paddingBottom: theme.spacing.lg,
  },
  upgradeModalFooter: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    borderTopWidth: 1,
    borderTopColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
  },
  ownerTransferList: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  ownerTransferOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  ownerTransferOptionSelected: {
    borderColor: theme.colors.accentPrimary,
    backgroundColor: theme.colors.accentSoft,
  },
  ownerTransferOptionCopy: {
    flex: 1,
    gap: 4,
  },
  ownerTransferOptionName: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  ownerTransferOptionHint: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  legalPromptCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    gap: theme.spacing.lg,
    ...theme.shadow.floating,
  },
  legalPromptHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  legalPromptHeaderCopy: {
    flex: 1,
  },
  legalPromptCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  legalModalCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "82%",
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    ...theme.shadow.floating,
  },
  legalModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  legalModalHeaderCopy: {
    flex: 1,
  },
  legalModalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  legalModalBody: {
    marginTop: theme.spacing.lg,
  },
  legalModalBodyContent: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  legalModalSummary: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  legalModalSection: {
    gap: theme.spacing.sm,
  },
  legalModalSectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  legalModalParagraph: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  modalTitle: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
  },
  modalDescription: {
    marginTop: theme.spacing.sm,
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  upgradeFeatureList: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  upgradeFeatureItem: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  upgradeDeveloperToggle: {
    marginTop: theme.spacing.md,
    minHeight: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  upgradeDeveloperToggleLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  upgradeDeveloperNote: {
    marginTop: theme.spacing.md,
    maxHeight: 188,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  upgradeDeveloperNoteContent: {
    paddingBottom: 2,
  },
  upgradeDeveloperNoteText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 21,
  },
  upgradeLoadingState: {
    marginTop: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  upgradeLoadingText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  upgradeOfferCard: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    gap: 6,
  },
  upgradeOfferEyebrow: {
    color: theme.colors.textTertiary,
    fontSize: 11,
    textTransform: "uppercase",
  },
  upgradeOfferTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  upgradeOfferMetaList: {
    gap: 8,
  },
  upgradeOfferMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  upgradeOfferMetaLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  upgradeOfferMetaValue: {
    flexShrink: 1,
    textAlign: "right",
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  upgradeOfferPrice: {
    color: theme.colors.accentPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  upgradeStatusBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
  },
  upgradeStatusText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  upgradeActiveBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.accentPrimary,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  upgradeActiveText: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  upgradeLegalCard: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
    gap: theme.spacing.sm,
  },
  upgradeLegalTitle: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  upgradeLegalLinkRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  upgradeLegalLinkButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  upgradeLegalLinkButtonWide: {
    minHeight: 40,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.surfaceCard,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  upgradeLegalLinkLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  upgradeSubscriptionNotice: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.lineSoft,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  upgradeSubscriptionNoticeText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  upgradeModalActions: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  pageActions: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  modalActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
  },
  modalActionsStacked: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
});
