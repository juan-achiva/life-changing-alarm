import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, BackHandler, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, Vibration, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { buildWakeAlarmPlan, formatClock, formatDuration, getCoachMessage, getLastCallAt } from "@/src/features/out-app/planning";
import { isValidTime, scheduleSnoozeNotification, scheduleWakeNotification } from "@/src/features/out-app/alarmNotifications";
import { consumePendingNativeAlarm } from "@/src/features/out-app/nativeAlarm";
import { getPostFeedback } from "@/src/features/out-app/aiFeedback";
import { deleteGroupRecord, publishGroupRecord, reportGroupRecord, subscribeGroupFeed } from "@/src/features/out-app/feedSync";
import { deleteAllUserData } from "@/src/features/out-app/accountData";
import { createOutGroup, joinOutGroup, leaveOutGroup, normalizeInviteCode, subscribeOutGroup } from "@/src/features/out-app/groups";
import { registerGroupPushNotifications } from "@/src/features/out-app/groupPushNotifications";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, openLegalPage } from "@/src/features/out-app/legal";
import { loadBlockedUsers, loadOutState, saveActiveWake, saveBlockedUsers, saveCharacter, saveCharacterEnabled, saveCustomCharacter, saveGroup, saveHistory, savePlan } from "@/src/features/out-app/storage";
import { startStopwatchSurface, stopStopwatchSurface } from "@/src/features/out-app/stopwatchSurface";
import { C, s } from "@/src/features/out-app/styles";
import type { AppPhase, CharacterId, CustomCharacter, GroupProfile, MorningPlan, WakeToOutRecord } from "@/src/features/out-app/types";
import { auth } from "@/src/lib/firebase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

type MainTab = "feed" | "character" | "report" | "group";

function isUsableAlarmEventTime(timestamp: number) {
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && age >= -5 * 60_000 && age <= 24 * 60 * 60_000;
}

export default function OutApp() {
  const [phase, setPhase] = useState<AppPhase>("tomorrow");
  const [tab, setTab] = useState<MainTab>("feed");
  const [group, setGroup] = useState<GroupProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [plan, setPlan] = useState<MorningPlan | null>(null);
  const [history, setHistory] = useState<WakeToOutRecord[]>([]);
  const [feedRecords, setFeedRecords] = useState<WakeToOutRecord[]>([]);
  const [activeWakeAt, setActiveWakeAt] = useState<number | null>(null);
  const [lastRecord, setLastRecord] = useState<WakeToOutRecord | null>(null);
  const [now, setNow] = useState(Date.now());
  const [eventTitle, setEventTitle] = useState("EXAM");
  const [wakeTime, setWakeTime] = useState("07:20");
  const [outTime, setOutTime] = useState("08:05");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [repeatDays, setRepeatDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [character, setCharacter] = useState<CharacterId>("kind");
  const [customCharacter, setCustomCharacter] = useState<CustomCharacter>({ name: "MY VOICE", personality: "친한 친구처럼 솔직하고 재치 있게 말한다." });
  const [characterEnabled, setCharacterEnabled] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const exitPromptOpen = useRef(false);
  const planRef = useRef<MorningPlan | null>(null);
  const activeWakeAtRef = useRef<number | null>(null);
  planRef.current = plan;
  activeWakeAtRef.current = activeWakeAt;
  const groupId = group?.id;
  const groupMemberName = group?.memberName;

  const beginWakeToOut = useCallback(async (dismissedAt: number, targetPlan?: MorningPlan | null) => {
    const currentPlan = targetPlan ?? planRef.current;
    if (!currentPlan || !isUsableAlarmEventTime(dismissedAt)) return;
    const existing = activeWakeAtRef.current;
    const wakeAt = existing && Date.now() - existing < 18 * 60 * 60_000 ? existing : dismissedAt;
    activeWakeAtRef.current = wakeAt;
    setActiveWakeAt(wakeAt);
    setNow(Date.now());
    setPhase("timer");
    await Promise.all([saveActiveWake(wakeAt), startStopwatchSurface(wakeAt, currentPlan.targetOutAt)]);
  }, []);

  useEffect(() => {
    Promise.all([loadOutState(), loadBlockedUsers()]).then(async ([state, blocked]) => {
      const pendingAlarm = await consumePendingNativeAlarm();
      const pendingWakeAt = pendingAlarm?.kind === "wake-alarm" && isUsableAlarmEventTime(pendingAlarm.timestamp) ? pendingAlarm.timestamp : null;
      const restoredWakeAt = pendingWakeAt ?? state.activeWakeAt;
      const serverGroup = state.group && !state.group.id.startsWith("local-group-") && !state.group.id.startsWith("group-") ? state.group : null;
      planRef.current = state.plan;
      activeWakeAtRef.current = restoredWakeAt;
      setPlan(state.plan); setHistory(state.history); setActiveWakeAt(restoredWakeAt); setGroup(serverGroup); setCharacter(state.character); setCustomCharacter(state.customCharacter); setCharacterEnabled(state.characterEnabled);
      if (state.group && !serverGroup) void saveGroup(null);
      if (state.plan) {
        setEventTitle(state.plan.eventTitle);
        setWakeTime(formatClock(state.plan.wakeAt));
        setOutTime(formatClock(state.plan.targetOutAt));
        setRepeatDays(state.plan.repeatDays ?? []);
      }
      if (pendingWakeAt && state.plan) {
        await beginWakeToOut(pendingWakeAt, state.plan);
      } else if (restoredWakeAt) {
        setNow(Date.now());
        setPhase("timer");
      }
      setBlockedUsers(blocked);
    }).finally(() => setBooting(false));
  }, [beginWakeToOut]);

  useEffect(() => {
    if (!plan) return;
    const restorePendingWake = async () => {
      const pendingAlarm = await consumePendingNativeAlarm();
      if (!pendingAlarm) return;
      if (pendingAlarm.kind === "wake-alarm") {
        await beginWakeToOut(pendingAlarm.timestamp, plan);
        return;
      }
      if (activeWakeAtRef.current) {
        setNow(Date.now());
        setPhase("timer");
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void restorePendingWake();
    });
    void restorePendingWake();
    return () => subscription.remove();
  }, [plan, beginWakeToOut]);

  useEffect(() => {
    if (phase !== "timer") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const kind = notification.request.content.data.kind;
      if (!plan) return;
      if (kind === "wake-alarm") setPhase("alarm");
      if ((kind === "last-call" || kind === "out-alarm" || kind === "departure-nudge") && activeWakeAtRef.current) {
        setNow(Date.now());
        setPhase("timer");
      }
    });
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data.kind === "group-post") { setPhase("tomorrow"); setTab("feed"); return; }
      if (data.kind === "wake-alarm" && plan) { void beginWakeToOut(Date.now(), plan); return; }
      if (data.kind === "last-call" || data.kind === "out-alarm" || data.kind === "departure-nudge") {
        if (activeWakeAtRef.current) {
          setNow(Date.now());
          setPhase("timer");
        } else {
          setPhase("tomorrow");
          setTab("feed");
        }
      }
    });
    return () => { received.remove(); responded.remove(); };
  }, [plan, beginWakeToOut]);

  useEffect(() => {
    if (!groupId || !groupMemberName || groupId.startsWith("local-group-") || groupId.startsWith("group-")) return;
    const stopGroup = subscribeOutGroup(groupId, groupMemberName, (next) => {
      setGroup(next);
      void saveGroup(next);
    }, (error) => console.warn("Group sync failed", error));
    const stopFeed = subscribeGroupFeed(groupId, setFeedRecords, (error) => console.warn("Feed sync failed", error));
    return () => { stopGroup(); stopFeed(); };
  }, [groupId, groupMemberName]);

  useEffect(() => {
    if (!groupId || groupId.startsWith("local-group-") || groupId.startsWith("group-")) return;
    void registerGroupPushNotifications(groupId).catch((error) => console.warn("Push registration failed", error));
  }, [groupId]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "result") {
        setPhase("tomorrow");
        setTab("feed");
        return true;
      }
      if (phase === "alarm" || phase === "timer") {
        Alert.alert("진행 중인 모닝", phase === "timer" ? "외출 시간 측정 중이에요. 인증을 완료한 뒤 돌아갈 수 있어요." : "알람 화면의 버튼으로 다음 단계로 이동해 주세요.");
        return true;
      }
      if (tab !== "feed") {
        setTab("feed");
        return true;
      }
      if (exitPromptOpen.current) return true;
      exitPromptOpen.current = true;
      Alert.alert("OUT을 종료할까요?", "한 번 더 확인한 뒤 앱을 종료합니다.", [
        { text: "취소", style: "cancel", onPress: () => { exitPromptOpen.current = false; } },
        { text: "종료", style: "destructive", onPress: () => { exitPromptOpen.current = false; BackHandler.exitApp(); } },
      ], { cancelable: true, onDismiss: () => { exitPromptOpen.current = false; } });
      return true;
    });
    return () => subscription.remove();
  }, [phase, tab]);

  const elapsedSeconds = activeWakeAt ? Math.floor((now - activeWakeAt) / 1000) : 0;
  const remainingSeconds = plan ? Math.floor((plan.targetOutAt - now) / 1000) : 0;
  const comparison = useMemo(() => lastRecord && history[1] ? history[1].durationSeconds - lastRecord.durationSeconds : null, [history, lastRecord]);

  const createPlan = async () => {
    if (!isValidTime(wakeTime) || !isValidTime(outTime)) {
      Alert.alert("시간을 확인해 주세요", "기상 시간과 목표 출발 시간을 24시간 형식으로 입력해 주세요. 예: 07:20"); return false;
    }
    const next = buildWakeAlarmPlan({ label: eventTitle, wakeTime, outTime, repeatDays });
    const scheduled = await scheduleWakeNotification(next, { soundEnabled, vibrationEnabled });
    if (!scheduled.ok) {
      Alert.alert("알람을 예약하지 못했어요", scheduled.error ?? "알림 권한과 기기 설정을 확인해 주세요.");
      return false;
    }
    setPlan(next); await savePlan(next);
    const dayLabel = new Date(next.wakeAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
    Alert.alert("알람 저장 완료", `${dayLabel} ${formatClock(next.wakeAt)}에 실제 기기 알람을 예약했습니다.`);
    return true;
  };

  const stopAlarm = async () => {
    await beginWakeToOut(Date.now(), plan);
  };

  const snoozeAlarm = async () => {
    Vibration.cancel();
    if (plan) await scheduleSnoozeNotification(plan, { soundEnabled, vibrationEnabled });
    setPhase("tomorrow");
    setTab("feed");
    Alert.alert("다시 알림", "5분 뒤에 다시 울립니다.");
  };

  const finishOut = async (withPhoto: boolean) => {
    if (!activeWakeAt || !plan || !group) return;
    let photoUri: string | null = null;
    if (withPhoto) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { Alert.alert("CAMERA NEEDED", "Allow camera access to create your departure proof."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [4, 5] });
      if (result.canceled) return;
      photoUri = result.assets[0]?.uri ?? null;
    }
    const outAt = Date.now();
    const durationSeconds = Math.floor((outAt - activeWakeAt) / 1000);
    const deltaSeconds = Math.floor((plan.targetOutAt - outAt) / 1000);
    const recentComments = feedRecords.filter((item) => item.aiCharacter === character && item.aiComment).slice(0, 5).map((item) => item.aiComment!);
    const record: WakeToOutRecord = { id: `record-${outAt}`, groupId: group.id, wakeAt: activeWakeAt, outAt, targetOutAt: plan.targetOutAt, durationSeconds, deltaSeconds, photoUri, authorName: group.memberName ?? "ME", aiCharacter: character, aiCharacterName: character === "custom" ? customCharacter.name : undefined, departureMode: activeWakeAt >= getLastCallAt(plan) ? "last-call" : "ready" };
    const next = [record, ...history].slice(0, 30);

    // 촬영이 끝나는 순간 인증은 완료된 것으로 처리한다. 네트워크 작업 때문에
    // 타이머 화면에 사용자를 붙잡아 두지 않는다.
    setFeedRecords((records) => [record, ...records.filter((item) => item.id !== record.id)]);
    activeWakeAtRef.current = null;
    setLastRecord(record); setHistory(next); setActiveWakeAt(null); setPhase("tomorrow"); setTab("feed");
    void Promise.all([saveHistory(next), saveActiveWake(null), stopStopwatchSurface(outAt)]);

    void (async () => {
      try {
        const comment = characterEnabled ? getPostFeedback({ character, characterName: character === "custom" ? customCharacter.name : undefined, personality: character === "custom" ? customCharacter.personality : undefined, durationSeconds, deltaSeconds, previousDurationSeconds: history[0]?.durationSeconds, recentComments, variationIndex: Math.floor(outAt / 1000) % 6 }) : Promise.resolve(undefined);
        const syncedRecord = await publishGroupRecord(group, record, comment);
        setFeedRecords((records) => [syncedRecord, ...records.filter((item) => item.id !== syncedRecord.id)]);
        setHistory((records) => records.map((item) => item.id === syncedRecord.id ? syncedRecord : item));
      } catch (error) {
        Alert.alert("서버 저장에 실패했어요", error instanceof Error ? error.message : "네트워크 연결을 확인해 주세요.");
      }
    })();
  };

  if (booting) return <SafeAreaView style={s.boot}><Text style={s.bootLogo}>OUT</Text><Text style={s.bootCopy}>CHANGE YOUR LIFE WITH AN ALARM</Text></SafeAreaView>;

  if (!group) return <GroupGate onComplete={(next) => { setGroup(next); void saveGroup(next); }} />;

  if (phase === "alarm" && plan) return <SafeAreaView style={s.safe}><Alarm plan={plan} soundEnabled={soundEnabled} vibrationEnabled={vibrationEnabled} onStop={stopAlarm} onSnooze={snoozeAlarm} /></SafeAreaView>;
  if (phase === "timer" && plan) return <SafeAreaView style={s.safe}><Header label={now >= getLastCallAt(plan) ? "LAST CALL" : "MORNING"} /><Timer elapsed={elapsedSeconds} remaining={remainingSeconds} emergency={now >= getLastCallAt(plan)} plan={plan} onOut={() => void finishOut(true)} onSkip={() => void finishOut(false)} /></SafeAreaView>;
  if (phase === "result" && lastRecord) return <SafeAreaView style={s.safe}><Header label="SHARED TO GROUP" /><Result record={lastRecord} previous={history[1] ?? null} comparison={comparison} onDone={() => { setPhase("tomorrow"); setTab("feed"); }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe}>
      <Header label="" />
      {tab === "feed" && <Feed group={group} history={feedRecords.filter((record) => record.outAt >= Date.now() - 7 * 24 * 60 * 60_000 && (!record.authorUserId || !blockedUsers.includes(record.authorUserId)))} onPostAction={(record) => showPostActions(record, group, setFeedRecords, blockedUsers, setBlockedUsers)} alarm={{ plan, values: { eventTitle, wakeTime, outTime }, setters: { setEventTitle, setWakeTime, setOutTime }, repeatDays, onRepeatDaysChange: setRepeatDays, soundEnabled, vibrationEnabled, onSoundChange: setSoundEnabled, onVibrationChange: setVibrationEnabled, onCalculate: createPlan }} />}
      {tab === "character" && <CharacterView enabled={characterEnabled} selected={character} custom={customCharacter} onEnabledChange={(next) => { setCharacterEnabled(next); void saveCharacterEnabled(next); }} onSelect={(next) => { setCharacter(next); void saveCharacter(next); }} onCustomChange={(next) => { setCustomCharacter(next); void saveCustomCharacter(next); }} />}
      {tab === "report" && <Report history={history} />}
      {tab === "group" && <GroupView group={group} onLeave={async () => { await leaveOutGroup(group); await saveGroup(null); setGroup(null); setTab("feed"); }} onDeleteData={async () => { await deleteAllUserData(group); setGroup(null); setPlan(null); setHistory([]); setFeedRecords([]); setActiveWakeAt(null); setTab("feed"); }} />}
      <BottomNav active={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

function Header({ label }: { label: string }) {
  return <View style={s.header}><View style={s.logoRow}><Text style={s.logo}>OUT</Text><View style={s.dot} /></View><Text style={s.brand}>알람으로 인생바꾸기</Text>{label ? <Text style={s.phase}>{label.toUpperCase()}</Text> : null}</View>;
}

function GroupGate({ onComplete }: { onComplete: (group: GroupProfile) => void }) {
  const [mode, setMode] = useState<"create" | "join">("join");
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("MORNING CREW");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!name.trim() || (mode === "join" && !code.trim()) || (mode === "create" && !groupName.trim())) { Alert.alert("CHECK THE FORM"); return; }
    setSubmitting(true);
    try {
      const group = mode === "create" ? await createOutGroup(groupName.trim(), name.trim()) : await joinOutGroup(code, name.trim());
      onComplete(group);
      if (mode === "create") Alert.alert("그룹 생성 완료", `초대 코드 ${group.inviteCode}\n친구에게 이 코드를 공유해 주세요.`);
    } catch (error) {
      Alert.alert("그룹에 들어갈 수 없어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally { setSubmitting(false); }
  };
  return <SafeAreaView style={s.gateSafe}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={8}><ScrollView contentContainerStyle={s.gate} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets bounces={false}><View style={s.gateIntro}><Text style={s.gateLogo}>OUT.</Text><Text style={s.gateTitle}>BETTER MORNINGS,{`\n`}TOGETHER.</Text><Text style={s.gateCopy} lineBreakStrategyIOS="hangul-word">친구와 같은 그룹에서 기상 후 외출 기록을 공유하세요. 새 그룹을 만들면 초대 코드가 바로 발급됩니다.</Text></View><View style={s.segment}><Pressable onPress={() => setMode("join")} style={[s.segmentItem, mode === "join" && s.segmentActive]}><Text style={[s.segmentText, mode === "join" && s.segmentTextActive]}>JOIN</Text></Pressable><Pressable onPress={() => setMode("create")} style={[s.segmentItem, mode === "create" && s.segmentActive]}><Text style={[s.segmentText, mode === "create" && s.segmentTextActive]}>CREATE</Text></Pressable></View><View style={s.gateForm}><Field label="YOUR NAME" value={name} onChange={setName} />{mode === "join" ? <Field label="INVITE CODE" value={code} onChange={(value) => setCode(normalizeInviteCode(value))} /> : <Field label="GROUP NAME" value={groupName} onChange={setGroupName} />}<Button label={submitting ? "CHECKING..." : mode === "join" ? "JOIN GROUP" : "CREATE & GET CODE"} onPress={() => void submit()} /></View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function Feed({ group, history, alarm, onPostAction }: { group: GroupProfile; history: WakeToOutRecord[]; alarm: AlarmSetupProps; onPostAction: (record: WakeToOutRecord) => void }) {
  return <ScrollView contentContainerStyle={s.feed} keyboardShouldPersistTaps="handled"><FeedAlarmCard {...alarm} /><View style={s.feedSection}><View><Text style={s.feedSectionLabel}>CREW FEED</Text><Text style={s.feedSectionName}>{group.name}</Text></View><View style={s.memberPill}><Ionicons name="people" size={13} /><Text style={s.memberText}>{group.memberNames.length}</Text></View></View>{history.length ? history.map((record) => <ProofPost key={record.id} record={record} onMenu={() => onPostAction(record)} />) : <View style={s.empty}><Text style={s.emptyBig}>NO ONE IS OUT YET.</Text><Text style={s.emptyCopy}>위에서 알람을 맞추고, 기상 후 첫 외출 인증을 남겨보세요.</Text></View>}</ScrollView>;
}

function ProofPost({ record, onMenu }: { record: WakeToOutRecord; onMenu: () => void }) {
  const character = CHARACTERS.find((item) => item.id === record.aiCharacter) ?? CHARACTERS[0];
  const characterName = record.aiCharacter === "custom" ? record.aiCharacterName ?? "MY VOICE" : character.name;
  return <View style={s.post}><View style={s.postHeader}><View style={s.avatar}><Text style={s.avatarText}>{(record.authorName ?? "ME").slice(0, 1)}</Text></View><View><Text style={s.postAuthor}>{record.authorName ?? "ME"}</Text><Text style={s.postMeta}>{formatClock(record.outAt)} · {record.departureMode === "last-call" ? "LAST CALL OUT" : "READY OUT"}</Text></View><Text style={s.postDelta}>{record.deltaSeconds >= 0 ? `${Math.ceil(record.deltaSeconds / 60)}M EARLY` : `${Math.ceil(-record.deltaSeconds / 60)}M LATE`}</Text><Pressable accessibilityLabel="게시물 메뉴" onPress={onMenu} hitSlop={12} style={s.postMenu}><Ionicons name="ellipsis-horizontal" size={20} color={C.muted} /></Pressable></View><View style={s.postPhoto}>{record.photoUri ? <Image source={{ uri: record.photoUri }} contentFit="cover" style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, s.placeholder]} />}<View style={s.shade} /><View style={s.overlay}><Text style={s.proofBrand}>OUT.</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={s.proofTime}>{formatDuration(record.durationSeconds)}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={s.proofDuration}>{formatClock(record.wakeAt)} WAKE → {formatClock(record.outAt)} OUT</Text></View></View>{record.aiComment ? <View style={s.aiComment}><View style={[s.characterFace, { backgroundColor: character.color }]}><Text style={s.characterEmoji}>{character.emoji}</Text></View><View style={s.aiCommentBody}><Text style={s.aiCommentName}>{characterName}</Text><Text style={s.aiCommentText}>{record.aiComment}</Text></View></View> : null}</View>;
}

function showPostActions(record: WakeToOutRecord, group: GroupProfile, setRecords: React.Dispatch<React.SetStateAction<WakeToOutRecord[]>>, blocked: string[], setBlocked: React.Dispatch<React.SetStateAction<string[]>>) {
  const mine = Boolean(record.authorUserId && record.authorUserId === auth?.currentUser?.uid);
  const hide = () => setRecords((items) => items.filter((item) => item.id !== record.id));
  const actions = mine ? [
    { text: "게시물 삭제", style: "destructive" as const, onPress: () => void deleteGroupRecord(group.id, record).then(hide).catch((error) => Alert.alert("삭제하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.")) },
  ] : [
    { text: "이 게시물 숨기기", onPress: hide },
    { text: "사용자 차단", style: "destructive" as const, onPress: () => { if (!record.authorUserId) return; const next = [...new Set([...blocked, record.authorUserId])]; setBlocked(next); void saveBlockedUsers(next); } },
    { text: "신고하기", style: "destructive" as const, onPress: () => void reportGroupRecord(group.id, record).then(() => { hide(); Alert.alert("신고가 접수됐어요", "확인 후 필요한 조치를 진행할게요."); }).catch((error) => Alert.alert("신고하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.")) },
  ];
  Alert.alert("게시물 관리", mine ? "내 게시물을 삭제할 수 있어요." : "불편한 콘텐츠를 숨기거나 신고할 수 있어요.", [...actions, { text: "취소", style: "cancel" }]);
}

function Report({ history }: { history: WakeToOutRecord[] }) {
  const average = history.length ? Math.round(history.reduce((sum, item) => sum + item.durationSeconds, 0) / history.length) : 0;
  const best = history.length ? Math.min(...history.map((item) => item.durationSeconds)) : 0;
  return <ScrollView contentContainerStyle={s.feed}><Text style={s.eyebrow}>YOUR CHANGE</Text><Text style={s.feedTitle}>WAKE → OUT</Text><View style={s.reportGrid}><Metric label="AVERAGE" value={history.length ? formatDuration(average) : "--:--"} /><Metric label="BEST" value={history.length ? formatDuration(best) : "--:--"} accent /></View><View style={s.history}><Text style={s.cardLabel}>ALL RECORDS</Text>{history.map((r, i) => <View style={s.historyRow} key={r.id}><Text style={s.index}>{String(i + 1).padStart(2, "0")}</Text><Text style={s.date}>{new Date(r.outAt).toLocaleDateString()}</Text><Text style={s.historyTime}>{formatDuration(r.durationSeconds)}</Text></View>)}</View></ScrollView>;
}

function GroupView({ group, onLeave, onDeleteData }: { group: GroupProfile; onLeave: () => Promise<void>; onDeleteData: () => Promise<void> }) {
  const confirmLeave = () => Alert.alert("그룹에서 나갈까요?", "다시 참여하려면 초대 코드가 필요합니다.", [{ text: "취소", style: "cancel" }, { text: "그룹 나가기", style: "destructive", onPress: () => void onLeave().catch((error) => Alert.alert("나갈 수 없어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.")) }]);
  const confirmDelete = () => Alert.alert("내 데이터를 모두 삭제할까요?", "본인 게시물, 인증 사진, 기록과 익명 계정이 영구 삭제됩니다. 되돌릴 수 없어요.", [{ text: "취소", style: "cancel" }, { text: "영구 삭제", style: "destructive", onPress: () => void onDeleteData().catch((error) => Alert.alert("삭제하지 못했어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.")) }]);
  const open = (url: string) => void openLegalPage(url).catch((error) => Alert.alert("페이지를 열 수 없어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."));
  return <ScrollView contentContainerStyle={s.feed}><Text style={s.eyebrow}>SETTINGS · YOUR CREW</Text><Text style={s.feedTitle}>{group.name}</Text><View style={s.codeCard}><Text style={s.cardLabel}>INVITE CODE</Text><Text style={s.code}>{group.inviteCode}</Text><Text style={s.gateCopy}>이 코드를 받은 사람만 그룹에 참여할 수 있어요.</Text></View><Text style={s.cardLabel}>MEMBERS</Text>{group.memberNames.map((name, index) => <View style={s.memberRow} key={`${name}-${index}`}><View style={s.avatar}><Text style={s.avatarText}>{name.slice(0, 1)}</Text></View><Text style={s.postAuthor}>{name}</Text>{name === group.memberName ? <Text style={s.you}>YOU</Text> : null}</View>)}<View style={s.settingsCard}><SettingsAction icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => open(PRIVACY_URL)} /><SettingsAction icon="document-text-outline" label="이용약관·커뮤니티 가이드" onPress={() => open(TERMS_URL)} /><SettingsAction icon="mail-outline" label="문의하기" onPress={() => open(`mailto:${SUPPORT_EMAIL}`)} /><SettingsAction icon="exit-outline" label="그룹 나가기" danger onPress={confirmLeave} /><SettingsAction icon="trash-outline" label="내 데이터 모두 삭제" danger onPress={confirmDelete} /></View></ScrollView>;
}

function SettingsAction({ icon, label, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  const color = danger ? C.orange : C.ink;
  return <Pressable onPress={onPress} style={s.settingsAction}><Ionicons name={icon} size={21} color={color} /><Text style={[s.settingsActionText, { color }]}>{label}</Text><Ionicons name="chevron-forward" size={18} color={color} /></Pressable>;
}

function BottomNav({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  const insets = useSafeAreaInsets();
  const tabs: { key: MainTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [{ key: "feed", label: "FEED", icon: "images" }, { key: "character", label: "CHARACTER", icon: "chatbubble-ellipses" }, { key: "report", label: "REPORT", icon: "bar-chart" }, { key: "group", label: "GROUP", icon: "people" }];
  return <View style={[s.nav, { bottom: Math.max(insets.bottom, 10) }]}>{tabs.map((item) => <Pressable key={item.key} onPress={() => onChange(item.key)} style={[s.navItem, active === item.key && s.navActive]}><Ionicons name={item.icon} size={20} color={active === item.key ? C.ink : C.muted} /><Text style={[s.navText, active === item.key && s.navTextActive]}>{item.label}</Text></Pressable>)}</View>;
}

type Values = { eventTitle: string; wakeTime: string; outTime: string };
type Setters = { setEventTitle: (v: string) => void; setWakeTime: (v: string) => void; setOutTime: (v: string) => void };
type AlarmSetupProps = { plan: MorningPlan | null; values: Values; setters: Setters; repeatDays: number[]; onRepeatDaysChange: (value: number[]) => void; soundEnabled: boolean; vibrationEnabled: boolean; onSoundChange: (value: boolean) => void; onVibrationChange: (value: boolean) => void; onCalculate: () => Promise<boolean> };

const CHARACTERS: { id: CharacterId; name: string; emoji: string; tagline: string; example: string; color: string }[] = [
  { id: "kind", name: "MORI", emoji: "🌤️", tagline: "다정한 모닝 메이트", example: "오늘도 잘 나왔어요. 어제보다 조금 더 가벼워졌네요.", color: "#D9FF43" },
  { id: "tough", name: "SPIKE", emoji: "⚡", tagline: "친근한 독설 코치", example: "침대랑 작별하는 데 43분? 내일은 3분만 덜 사랑하자.", color: "#FF7959" },
  { id: "analyst", name: "ZERO", emoji: "📊", tagline: "냉철한 기록 분석가", example: "최근 평균보다 6분 단축했습니다. 현재 흐름을 유지하세요.", color: "#A8D8FF" },
  { id: "hype", name: "BOOM", emoji: "🔥", tagline: "열혈 트레이너", example: "좋아! 오늘도 OUT 성공! 내일은 여기서 3분 더 줄이자!", color: "#FFD84A" },
  { id: "custom", name: "MY VOICE", emoji: "✦", tagline: "내가 직접 만드는 캐릭터", example: "이름과 성격, 말투를 원하는 대로 설정하세요.", color: "#D8CBFF" },
];

function FeedAlarmCard(props: AlarmSetupProps) {
  const [editing, setEditing] = useState(!props.plan);
  const save = async () => { const saved = await props.onCalculate(); if (saved) setEditing(false); };
  return <View style={s.feedAlarm}>
    <View style={s.feedAlarmHeader}><View style={s.feedAlarmKicker}><View style={s.alarmGlyph}><Ionicons name="alarm" size={20} color={C.ink} /></View><View><Text style={s.feedAlarmKickerText}>NEXT WAKE</Text><Text style={s.feedAlarmDate}>{props.plan ? new Date(props.plan.wakeAt).toLocaleDateString("ko-KR", { weekday: "long", month: "short", day: "numeric" }) : "첫 알람을 설정하세요"}</Text></View></View><Pressable accessibilityLabel="알람 설정" onPress={() => setEditing(!editing)} style={s.feedAlarmEdit}><Ionicons name="settings-outline" size={21} color={C.white} /></Pressable></View>
    {!editing ? <View style={s.alarmHero}><View style={s.alarmTimeRow}><Text style={s.alarmHeroTime}>{props.plan ? formatClock(props.plan.wakeAt) : props.values.wakeTime}</Text><Text style={s.alarmHeroWake}>WAKE</Text></View>{props.plan ? <View style={s.lastCallStrip}><Text style={s.lastCallLabel}>LAST CALL</Text><Text style={s.lastCallTime}>{formatClock(getLastCallAt(props.plan))}</Text><Text style={s.lastCallArrow}>→</Text><Text style={s.lastCallOut}>OUT {formatClock(props.plan.targetOutAt)}</Text></View> : null}<View style={s.alarmOutRow}><View style={s.alarmNameBlock}><Text numberOfLines={1} ellipsizeMode="tail" style={s.alarmName}>{props.plan?.eventTitle ?? props.values.eventTitle}</Text>{props.plan?.repeatDays?.length ? <Text style={s.alarmRepeat}>{props.plan.repeatDays.map((day) => "일월화수목금토"[day]).join(" · ")}</Text> : null}</View><View style={s.alarmOutPill}><Ionicons name="notifications" size={14} color={C.acid} /><Text style={s.alarmOutPillText}>PUSH RUSH</Text></View></View></View> : null}
    <Modal visible={editing} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent={false} onRequestClose={() => setEditing(false)}>
      <View style={s.alarmModal}>
        <View style={s.alarmModalHeader}><Pressable onPress={() => setEditing(false)} hitSlop={12}><Text style={s.alarmModalCancel}>취소</Text></Pressable><Text style={s.alarmModalTitle}>기상 알람</Text><Pressable onPress={() => void save()} hitSlop={12}><Text style={s.alarmModalSave}>저장</Text></Pressable></View>
        <KeyboardAvoidingView style={s.alarmModalBody} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.alarmNameField}><DarkField label="알람 이름" value={props.values.eventTitle} onChange={props.setters.setEventTitle} /></View>
          <View style={s.alarmModalSection}><View style={s.alarmSectionHeading}><Ionicons name="sunny-outline" size={15} color={C.acid} /><Text style={s.feedWheelLabel}>WAKE</Text></View><TimeWheel value={props.values.wakeTime} onChange={props.setters.setWakeTime} compact /></View>
          <View style={s.alarmModalSection}><View style={s.alarmSectionHeading}><Ionicons name="exit-outline" size={15} color={C.acid} /><Text style={s.feedWheelLabel}>TARGET OUT</Text></View><TimeWheel value={props.values.outTime} onChange={props.setters.setOutTime} compact /></View>
          <View style={s.alarmRepeatSection}><Text style={s.alarmOptionLabel}>반복</Text><View style={s.repeatButtons}>{["일","월","화","수","목","금","토"].map((day, index) => { const active = props.repeatDays.includes(index); return <Pressable key={day} onPress={() => props.onRepeatDaysChange(active ? props.repeatDays.filter((value) => value !== index) : [...props.repeatDays, index].sort())} style={[s.repeatDay, active && s.repeatDayActive]}><Text style={[s.repeatDayText, active && s.repeatDayTextActive]}>{day}</Text></Pressable>; })}</View></View>
          <View style={s.feedToggles}><View style={s.feedToggleItem}><View><Text style={s.feedToggleLabel}>사운드</Text><Text style={s.feedToggleHint}>알람음 재생</Text></View><Switch value={props.soundEnabled} onValueChange={props.onSoundChange} trackColor={{ false: "#45464F", true: C.orange }} /></View><View style={s.feedToggleDivider} /><View style={s.feedToggleItem}><View><Text style={s.feedToggleLabel}>진동</Text><Text style={s.feedToggleHint}>소리와 함께 진동</Text></View><Switch value={props.vibrationEnabled} onValueChange={props.onVibrationChange} trackColor={{ false: "#45464F", true: C.orange }} /></View></View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </View>;
}

function CharacterView({ enabled, selected, custom, onEnabledChange, onSelect, onCustomChange }: { enabled: boolean; selected: CharacterId; custom: CustomCharacter; onEnabledChange: (value: boolean) => void; onSelect: (value: CharacterId) => void; onCustomChange: (value: CustomCharacter) => void }) {
  const presets = CHARACTERS.filter((item) => item.id !== "custom");
  const customSelected = selected === "custom";
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={s.feed} keyboardShouldPersistTaps="handled"><Text style={s.feedTitle}>MAKE A VOICE.</Text><Text style={s.characterIntro}>내 아침 기록에 어떤 목소리가 답할지 정해보세요. 인증을 마치면 선택한 캐릭터가 짧은 댓글을 남깁니다.</Text><View style={s.characterToggle}><View style={s.characterToggleCopy}><Text style={s.characterToggleTitle}>캐릭터 댓글</Text><Text style={s.characterToggleDescription}>{enabled ? "사용 중" : "사용 안 함"}</Text></View><Switch style={s.characterSwitch} value={enabled} onValueChange={onEnabledChange} trackColor={{ false: "#56575B", true: C.orange }} /></View><View pointerEvents={enabled ? "auto" : "none"} style={!enabled ? s.characterDisabled : undefined}><Pressable onPress={() => onSelect("custom")} style={[s.customCharacterCard, customSelected && s.characterCardActive]}><View style={s.customTitleRow}><View style={[s.characterFace, { backgroundColor: "#D8CBFF" }]}><Text style={s.characterEmoji}>✦</Text></View><View><Text style={s.characterName}>{custom.name || "MY VOICE"}</Text><Text style={s.characterTagline}>CUSTOM CHARACTER</Text></View>{customSelected ? <Text style={s.characterSelected}>SELECTED</Text> : null}</View><Text style={s.customLabel}>CHARACTER NAME</Text><TextInput value={custom.name} onChangeText={(name) => onCustomChange({ ...custom, name: name.slice(0, 20) })} onFocus={() => onSelect("custom")} placeholder="예: 아침악마" placeholderTextColor="#8C887E" style={s.customInput} maxLength={20} /><Text style={s.customLabel}>PERSONALITY & TONE</Text><TextInput value={custom.personality} onChangeText={(personality) => onCustomChange({ ...custom, personality: personality.slice(0, 240) })} onFocus={() => onSelect("custom")} placeholder="예: 친한 형처럼 반말로 말하고, 목표보다 늦으면 재치 있게 잔소리한다." placeholderTextColor="#8C887E" style={[s.customInput, s.customPrompt]} multiline maxLength={240} /><Text style={s.customHint}>{custom.personality.length}/240 · 저장은 자동으로 됩니다.</Text></Pressable><Text style={s.characterDivider}>OR PICK A VOICE</Text>{presets.map((item) => { const active = selected === item.id; return <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[s.characterCard, active && s.characterCardActive]}><View style={[s.characterHero, { backgroundColor: item.color }]}><Text style={s.characterHeroEmoji}>{item.emoji}</Text></View><View style={s.characterCopy}><View style={s.characterNameRow}><Text style={s.characterName}>{item.name}</Text>{active ? <Text style={s.characterSelected}>SELECTED</Text> : null}</View><Text style={s.characterTagline}>{item.tagline}</Text><Text style={s.characterExample}>“{item.example}”</Text></View></Pressable>; })}</View></ScrollView></KeyboardAvoidingView>;
}

const WHEEL_ITEM_HEIGHT = 46;
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function TimeWheel({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const [hour = "07", minute = "00"] = value.split(":");
  const hour24 = Number(hour);
  const period = hour24 >= 12 ? 1 : 0;
  const hour12 = hour24 % 12 || 12;
  const update = (nextPeriod: number, nextHour12: number, nextMinute: string) => {
    const nextHour = nextHour12 % 12 + (nextPeriod === 1 ? 12 : 0);
    onChange(`${String(nextHour).padStart(2, "0")}:${nextMinute}`);
  };
  return <View style={[s.timeWheel, compact && s.timeWheelCompact]}>
    <View pointerEvents="none" style={s.wheelSelection} />
    <WheelColumn values={["오전", "오후"]} selected={period} onSelect={(next) => update(next, hour12, minute)} narrow />
    <WheelColumn values={HOURS} selected={hour12 - 1} onSelect={(next) => update(period, next + 1, minute)} />
    <Text style={s.wheelColon}>:</Text>
    <WheelColumn values={MINUTES} selected={Number(minute)} onSelect={(next) => update(period, hour12, String(next).padStart(2, "0"))} />
  </View>;
}

function WheelColumn({ values, selected, onSelect, narrow = false }: { values: string[]; selected: number; onSelect: (index: number) => void; narrow?: boolean }) {
  const ref = useRef<ScrollView>(null);
  const lastTick = useRef(selected);
  useEffect(() => { requestAnimationFrame(() => ref.current?.scrollTo({ y: selected * WHEEL_ITEM_HEIGHT, animated: false })); }, [selected]);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => onSelect(Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT))));
  const tick = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT)));
    if (index !== lastTick.current) { lastTick.current = index; void Haptics.selectionAsync(); }
  };
  return <ScrollView ref={ref} style={[s.wheelColumn, narrow && s.wheelColumnNarrow]} contentContainerStyle={s.wheelContent} showsVerticalScrollIndicator={false} snapToInterval={WHEEL_ITEM_HEIGHT} decelerationRate="fast" scrollEventThrottle={16} onScroll={tick} onMomentumScrollEnd={settle} nestedScrollEnabled>
    {values.map((item, index) => <Text key={item} style={[s.wheelItem, narrow && s.wheelPeriodItem, index === selected && s.wheelItemSelected]}>{item}</Text>)}
  </ScrollView>;
}

function DarkField({ label, value, onChange, suffix }: { label: string; value: string; onChange: (value: string) => void; suffix?: string }) {
  return <View style={s.darkField}><Text style={s.darkFieldLabel}>{label}</Text><View style={s.darkInputRow}><TextInput value={value} onChangeText={onChange} style={s.darkInput} keyboardType={suffix ? "number-pad" : "default"} autoCapitalize="characters" />{suffix ? <Text style={s.darkSuffix}>{suffix}</Text> : null}</View></View>;
}

function Alarm({ plan, soundEnabled, vibrationEnabled, onStop, onSnooze }: { plan: MorningPlan; soundEnabled: boolean; vibrationEnabled: boolean; onStop: () => void; onSnooze: () => void }) {
  const player = useAudioPlayer(require("../assets/alarm-tone.wav"));
  useEffect(() => {
    let active = true;
    player.loop = true;
    player.volume = 1;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).then(() => {
      if (active && soundEnabled) player.play();
    });
    return () => { active = false; };
  }, [player, soundEnabled]);
  useEffect(() => { if (vibrationEnabled) Vibration.vibrate([0, 700, 350, 700], true); return () => Vibration.cancel(); }, [vibrationEnabled]);
  const stop = () => { player.pause(); Vibration.cancel(); onStop(); };
  const snooze = () => { player.pause(); Vibration.cancel(); onSnooze(); };
  return <View style={s.ringing}><View style={s.ringingIcon}><Ionicons name="alarm" size={34} color={C.white} /></View><Text style={s.ringingLabel}>기상 알람</Text><Text style={s.ringingTime}>{formatClock(plan.wakeAt)}</Text><Text style={s.ringingName}>{plan.eventTitle}</Text><Text style={s.ringingOut}>목표 출발 {formatClock(plan.targetOutAt)}</Text><View style={s.ringingActions}><Pressable onPress={snooze} style={({ pressed }) => [s.snoozeButton, pressed && s.pressed]}><Ionicons name="time-outline" size={24} color={C.white} /><Text style={s.snoozeText}>다시 알림</Text></Pressable><Pressable onPress={stop} style={({ pressed }) => [s.stopCircle, pressed && s.pressed]}><Ionicons name="stop" size={26} color={C.white} /><Text style={s.stopCircleText}>기상 완료</Text></Pressable></View><Text style={s.stopHint}>기상 완료를 누르면 외출까지 시간 측정이 시작됩니다.</Text></View>;
}

function Timer({ elapsed, remaining, emergency, plan, onOut, onSkip }: { elapsed: number; remaining: number; emergency: boolean; plan: MorningPlan; onOut: () => void; onSkip: () => void }) {
  return <View style={[s.timer, emergency && s.timerEmergency]}>{emergency ? <View style={s.emergencyBanner}><Ionicons name="warning" size={16} color={C.white} /><Text style={s.emergencyBannerText}>LAST CALL · EMERGENCY OUT</Text></View> : null}<Text style={s.timerLabel}>SINCE WAKE</Text><Text style={s.timerValue}>{formatDuration(elapsed)}</Text><View style={[s.countdown, emergency && s.urgent, remaining <= 0 && s.overdue]}><Text style={s.countdownLabel}>{emergency ? "MINIMUM ROUTINE" : "UNTIL OUT"}</Text>{emergency ? <View style={s.timerSteps}><Text style={s.timerStep}>세수</Text><Text style={s.timerStep}>옷</Text><Text style={s.timerStep}>가방</Text></View> : <Text style={s.countdownValue}>{remaining >= 0 ? formatDuration(remaining) : `+${formatDuration(-remaining)}`}</Text>}<Text style={s.coach}>{getCoachMessage(remaining)}</Text></View><View style={s.timeline}><Text style={s.timelineText}>WAKE {formatClock(Date.now() - elapsed * 1000)}</Text><View style={s.timelineLine} /><Text style={s.timelineText}>OUT {formatClock(plan.targetOutAt)}</Text></View><Pressable onPress={onOut} style={({ pressed }) => [s.out, pressed && s.pressed]}><Ionicons name="camera" size={28} /><Text style={s.outText}>I&apos;M OUT</Text></Pressable><Pressable onPress={onSkip} style={s.skip}><Text style={s.skipText}>OUT WITHOUT PHOTO</Text></Pressable></View>;
}

function Result({ record, previous, comparison, onDone }: { record: WakeToOutRecord; previous: WakeToOutRecord | null; comparison: number | null; onDone: () => void }) {
  return <ScrollView contentContainerStyle={s.result}><Text style={s.eyebrow}>MORNING COMPLETE</Text><Text style={s.resultTitle}>YOU&apos;RE OUT.</Text><View style={s.proof}>{record.photoUri ? <Image source={{ uri: record.photoUri }} contentFit="cover" style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, s.placeholder]} />}<View style={s.shade} /><View style={s.overlay}><Text style={s.proofBrand}>OUT.</Text><Text style={s.proofTime}>{formatClock(record.outAt)}</Text><Text style={s.proofDuration}>WAKE → OUT · {formatDuration(record.durationSeconds)}</Text></View></View><View style={s.metrics}><Metric label="WAKE → OUT" value={formatDuration(record.durationSeconds)} /><Metric label="TARGET" value={record.deltaSeconds >= 0 ? `${Math.ceil(record.deltaSeconds / 60)} MIN EARLY` : `${Math.ceil(-record.deltaSeconds / 60)} MIN LATE`} accent={record.deltaSeconds >= 0} /></View><Text style={s.insight}>{previous ? comparison !== null && comparison > 0 ? `You were ${Math.ceil(comparison / 60)} minutes faster than last time.` : `Last time: ${formatDuration(previous.durationSeconds)}. Keep building the pattern.` : "첫 Wake-to-Out 기록을 저장했어요. 인증 피드에서 캐릭터의 댓글을 확인하세요."}</Text><Button label="BACK TO FEED" onPress={onDone} /></ScrollView>;
}

function Field({ label, value, onChange, suffix, numeric, compact }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; numeric?: boolean; compact?: boolean }) { return <View style={[s.field, compact && s.compact]}><Text style={s.fieldLabel}>{label}</Text><View style={s.inputRow}><TextInput value={value} onChangeText={onChange} style={s.input} keyboardType={numeric ? "number-pad" : "default"} autoCapitalize="characters" />{suffix && <Text style={s.suffix}>{suffix}</Text>}</View></View>; }
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue, accent && s.metricGood]}>{value}</Text></View>; }
function Button({ label, onPress, dark }: { label: string; onPress: () => void; dark?: boolean }) { return <Pressable onPress={onPress} style={({ pressed }) => [s.button, dark && s.buttonDark, pressed && s.pressed]}><Text style={[s.buttonText, dark && s.buttonTextDark]}>{label}</Text><Ionicons name="arrow-forward" size={20} color={dark ? C.white : C.ink} /></Pressable>; }
