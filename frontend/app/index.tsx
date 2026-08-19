import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { buildMorningPlan, formatClock, formatDuration, getCoachMessage } from "@/src/features/out-app/planning";
import { loadOutState, saveActiveWake, saveHistory, savePlan } from "@/src/features/out-app/storage";
import type { AppPhase, MorningPlan, WakeToOutRecord } from "@/src/features/out-app/types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const C = { ink: "#111111", paper: "#F4F1E8", white: "#FFFFFF", acid: "#D9FF43", orange: "#FF5C35", muted: "#77736A", line: "#D8D3C8" };

export default function OutApp() {
  const [phase, setPhase] = useState<AppPhase>("tomorrow");
  const [booting, setBooting] = useState(true);
  const [plan, setPlan] = useState<MorningPlan | null>(null);
  const [history, setHistory] = useState<WakeToOutRecord[]>([]);
  const [activeWakeAt, setActiveWakeAt] = useState<number | null>(null);
  const [lastRecord, setLastRecord] = useState<WakeToOutRecord | null>(null);
  const [now, setNow] = useState(Date.now());
  const [eventTitle, setEventTitle] = useState("EXAM");
  const [eventTime, setEventTime] = useState("09:00");
  const [travelMinutes, setTravelMinutes] = useState("35");
  const [prepMinutes, setPrepMinutes] = useState("45");

  useEffect(() => {
    loadOutState().then((state) => {
      setPlan(state.plan); setHistory(state.history); setActiveWakeAt(state.activeWakeAt);
      if (state.activeWakeAt) setPhase("timer");
    }).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (phase !== "timer") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const elapsedSeconds = activeWakeAt ? Math.floor((now - activeWakeAt) / 1000) : 0;
  const remainingSeconds = plan ? Math.floor((plan.targetOutAt - now) / 1000) : 0;
  const comparison = useMemo(() => lastRecord && history[1] ? history[1].durationSeconds - lastRecord.durationSeconds : null, [history, lastRecord]);

  const createPlan = async () => {
    const travel = Number(travelMinutes); const prep = Number(prepMinutes);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime) || !travel || !prep) {
      Alert.alert("CHECK YOUR PLAN", "Use HH:MM and enter valid travel/prep minutes."); return;
    }
    const next = buildMorningPlan({ eventTitle, eventTime, travelMinutes: travel, prepMinutes: prep, history });
    setPlan(next); await savePlan(next); await scheduleWakeNotification(next);
  };

  const stopAlarm = async () => {
    const wakeAt = Date.now(); setActiveWakeAt(wakeAt); setNow(wakeAt); setPhase("timer"); await saveActiveWake(wakeAt);
  };

  const finishOut = async (withPhoto: boolean) => {
    if (!activeWakeAt || !plan) return;
    let photoUri: string | null = null;
    if (withPhoto) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { Alert.alert("CAMERA NEEDED", "Allow camera access to create your departure proof."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [4, 5] });
      if (result.canceled) return;
      photoUri = result.assets[0]?.uri ?? null;
    }
    const outAt = Date.now();
    const record: WakeToOutRecord = { id: `record-${outAt}`, wakeAt: activeWakeAt, outAt, targetOutAt: plan.targetOutAt, durationSeconds: Math.floor((outAt - activeWakeAt) / 1000), deltaSeconds: Math.floor((plan.targetOutAt - outAt) / 1000), photoUri };
    const next = [record, ...history].slice(0, 30);
    setLastRecord(record); setHistory(next); setActiveWakeAt(null); setPhase("result");
    await Promise.all([saveHistory(next), saveActiveWake(null)]);
  };

  if (booting) return <SafeAreaView style={s.boot}><Text style={s.bootLogo}>OUT</Text><Text style={s.bootCopy}>CHANGE YOUR LIFE WITH AN ALARM</Text></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe}>
      <Header phase={phase} onHome={() => setPhase("tomorrow")} />
      {phase === "tomorrow" && <Tomorrow plan={plan} history={history} values={{ eventTitle, eventTime, travelMinutes, prepMinutes }} setters={{ setEventTitle, setEventTime, setTravelMinutes, setPrepMinutes }} onCalculate={createPlan} onPreview={() => plan ? setPhase("alarm") : Alert.alert("SET TOMORROW FIRST")} />}
      {phase === "alarm" && plan && <Alarm plan={plan} onStop={stopAlarm} />}
      {phase === "timer" && plan && <Timer elapsed={elapsedSeconds} remaining={remainingSeconds} plan={plan} onOut={() => void finishOut(true)} onSkip={() => void finishOut(false)} />}
      {phase === "result" && lastRecord && <Result record={lastRecord} previous={history[1] ?? null} comparison={comparison} onDone={() => setPhase("tomorrow")} />}
    </SafeAreaView>
  );
}

function Header({ phase, onHome }: { phase: AppPhase; onHome: () => void }) {
  return <View style={s.header}><Pressable onPress={onHome} style={s.logoRow}><Text style={s.logo}>OUT</Text><View style={s.dot} /></Pressable><Text style={s.brand}>알람으로 인생바꾸기</Text><Text style={s.phase}>{phase.toUpperCase()}</Text></View>;
}

type Values = { eventTitle: string; eventTime: string; travelMinutes: string; prepMinutes: string };
type Setters = { setEventTitle: (v: string) => void; setEventTime: (v: string) => void; setTravelMinutes: (v: string) => void; setPrepMinutes: (v: string) => void };
function Tomorrow({ plan, history, values, setters, onCalculate, onPreview }: { plan: MorningPlan | null; history: WakeToOutRecord[]; values: Values; setters: Setters; onCalculate: () => void; onPreview: () => void }) {
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
    <View style={s.intro}><Text style={s.eyebrow}>PLAN TOMORROW</Text><Text style={s.display}>DON&apos;T JUST WAKE UP.{"\n"}GET OUT ON TIME.</Text></View>
    <View style={s.formCard}>
      <Field label="WHAT'S TOMORROW?" value={values.eventTitle} onChange={setters.setEventTitle} />
      <View style={s.formRow}><Field label="START" value={values.eventTime} onChange={setters.setEventTime} compact /><Field label="TRAVEL" value={values.travelMinutes} onChange={setters.setTravelMinutes} suffix="MIN" numeric compact /><Field label="GET READY" value={values.prepMinutes} onChange={setters.setPrepMinutes} suffix="MIN" numeric compact /></View>
      <Button label="CALCULATE MY MORNING" onPress={onCalculate} />
    </View>
    {plan && <View style={s.planCard}><Text style={s.cardLabel}>AI MORNING PLAN</Text><View style={s.timeGrid}><Time label="WAKE" value={formatClock(plan.wakeAt)} /><Ionicons name="arrow-forward" size={24} color={C.ink} style={s.arrow} /><Time label="OUT" value={formatClock(plan.targetOutAt)} accent /></View><Text style={s.reason}>{plan.adjustmentMinutes > 0 ? `Recent mornings took longer. WAKE moved ${plan.adjustmentMinutes} min earlier.` : "Built from your travel time and normal preparation time."}</Text><Button label="PREVIEW ALARM" onPress={onPreview} dark /></View>}
    {!!history.length && <View style={s.history}><Text style={s.cardLabel}>RECENT WAKE → OUT</Text>{history.slice(0, 3).map((r, i) => <View style={s.historyRow} key={r.id}><Text style={s.index}>{String(i + 1).padStart(2, "0")}</Text><Text style={s.date}>{new Date(r.outAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</Text><Text style={s.historyTime}>{formatDuration(r.durationSeconds)}</Text></View>)}</View>}
  </ScrollView></KeyboardAvoidingView>;
}

function Alarm({ plan, onStop }: { plan: MorningPlan; onStop: () => void }) {
  return <View style={s.alarm}><Text style={s.alarmKicker}>WAKE UP</Text><Text style={s.alarmTime}>{formatClock(plan.wakeAt)}</Text><View style={s.rule} /><Text style={s.alarmOut}>OUT BY {formatClock(plan.targetOutAt)}</Text><Text style={s.alarmEvent}>{plan.eventTitle} · {plan.eventTime}</Text><Pressable onPress={onStop} style={({ pressed }) => [s.stop, pressed && s.pressed]}><Ionicons name="stop" size={28} /><Text style={s.stopText}>STOP ALARM</Text></Pressable></View>;
}

function Timer({ elapsed, remaining, plan, onOut, onSkip }: { elapsed: number; remaining: number; plan: MorningPlan; onOut: () => void; onSkip: () => void }) {
  return <View style={s.timer}><Text style={s.timerLabel}>SINCE WAKE</Text><Text style={s.timerValue}>{formatDuration(elapsed)}</Text><View style={[s.countdown, remaining <= 300 && s.urgent]}><Text style={s.countdownLabel}>UNTIL OUT</Text><Text style={s.countdownValue}>{remaining >= 0 ? formatDuration(remaining) : `+${formatDuration(-remaining)}`}</Text><Text style={s.coach}>{getCoachMessage(remaining)}</Text></View><View style={s.timeline}><Text style={s.timelineText}>WAKE {formatClock(Date.now() - elapsed * 1000)}</Text><View style={s.timelineLine} /><Text style={s.timelineText}>OUT {formatClock(plan.targetOutAt)}</Text></View><Pressable onPress={onOut} style={({ pressed }) => [s.out, pressed && s.pressed]}><Ionicons name="camera" size={28} /><Text style={s.outText}>I&apos;M OUT</Text></Pressable><Pressable onPress={onSkip} style={s.skip}><Text style={s.skipText}>OUT WITHOUT PHOTO</Text></Pressable></View>;
}

function Result({ record, previous, comparison, onDone }: { record: WakeToOutRecord; previous: WakeToOutRecord | null; comparison: number | null; onDone: () => void }) {
  return <ScrollView contentContainerStyle={s.result}><Text style={s.eyebrow}>MORNING COMPLETE</Text><Text style={s.resultTitle}>YOU&apos;RE OUT.</Text><View style={s.proof}>{record.photoUri ? <Image source={{ uri: record.photoUri }} contentFit="cover" style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, s.placeholder]} />}<View style={s.shade} /><View style={s.overlay}><Text style={s.proofBrand}>OUT.</Text><Text style={s.proofTime}>{formatClock(record.outAt)}</Text><Text style={s.proofDuration}>WAKE → OUT · {formatDuration(record.durationSeconds)}</Text></View></View><View style={s.metrics}><Metric label="WAKE → OUT" value={formatDuration(record.durationSeconds)} /><Metric label="TARGET" value={record.deltaSeconds >= 0 ? `${Math.ceil(record.deltaSeconds / 60)} MIN EARLY` : `${Math.ceil(-record.deltaSeconds / 60)} MIN LATE`} accent={record.deltaSeconds >= 0} /></View><Text style={s.insight}>{previous ? comparison !== null && comparison > 0 ? `You were ${Math.ceil(comparison / 60)} minutes faster than last time.` : `Last time: ${formatDuration(previous.durationSeconds)}. Keep building the pattern.` : "First record saved. Tomorrow’s recommendation will learn from this."}</Text><Button label="PLAN NEXT MORNING" onPress={onDone} /></ScrollView>;
}

function Field({ label, value, onChange, suffix, numeric, compact }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; numeric?: boolean; compact?: boolean }) { return <View style={[s.field, compact && s.compact]}><Text style={s.fieldLabel}>{label}</Text><View style={s.inputRow}><TextInput value={value} onChangeText={onChange} style={s.input} keyboardType={numeric ? "number-pad" : "default"} autoCapitalize="characters" />{suffix && <Text style={s.suffix}>{suffix}</Text>}</View></View>; }
function Time({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <View style={[s.time, accent && s.timeAccent]}><Text style={s.timeLabel}>{label}</Text><Text style={s.timeValue}>{value}</Text></View>; }
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue, accent && s.metricGood]}>{value}</Text></View>; }
function Button({ label, onPress, dark }: { label: string; onPress: () => void; dark?: boolean }) { return <Pressable onPress={onPress} style={({ pressed }) => [s.button, dark && s.buttonDark, pressed && s.pressed]}><Text style={[s.buttonText, dark && s.buttonTextDark]}>{label}</Text><Ionicons name="arrow-forward" size={20} color={dark ? C.white : C.ink} /></Pressable>; }

async function scheduleWakeNotification(plan: MorningPlan) {
  try {
    const permission = await Notifications.requestPermissionsAsync(); if (!permission.granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({ content: { title: "WAKE UP — OUT", body: `Alarm off → OUT by ${formatClock(plan.targetOutAt)}`, sound: true, data: { planId: plan.id } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.wakeAt) } });
  } catch { /* Expo Go may limit notification behavior. */ }
}

const s = StyleSheet.create({
  flex:{flex:1},safe:{flex:1,backgroundColor:C.paper},boot:{flex:1,backgroundColor:C.ink,alignItems:"center",justifyContent:"center"},bootLogo:{color:C.acid,fontSize:86,fontWeight:"900",letterSpacing:-7},bootCopy:{color:C.white,fontSize:11,fontWeight:"800",letterSpacing:2.4},
  header:{height:68,paddingHorizontal:20,borderBottomWidth:1,borderBottomColor:C.ink,flexDirection:"row",alignItems:"center"},logoRow:{flexDirection:"row",alignItems:"flex-start"},logo:{fontSize:31,lineHeight:34,fontWeight:"900",letterSpacing:-2.5},dot:{width:7,height:7,borderRadius:4,backgroundColor:C.orange,marginTop:5,marginLeft:2},brand:{fontSize:11,fontWeight:"800",marginLeft:12},phase:{marginLeft:"auto",fontSize:10,color:C.muted,fontWeight:"800",letterSpacing:1.4},
  scroll:{padding:20,paddingBottom:60,gap:18},intro:{paddingTop:12,gap:8},eyebrow:{fontSize:11,fontWeight:"900",letterSpacing:2,color:C.orange},display:{fontSize:38,lineHeight:39,fontWeight:"900",letterSpacing:-2.3},formCard:{borderWidth:1,borderColor:C.ink,backgroundColor:C.white,padding:16,gap:14},formRow:{flexDirection:"row",gap:8},field:{gap:5},compact:{flex:1},fieldLabel:{fontSize:9,fontWeight:"900",letterSpacing:1,color:C.muted},inputRow:{flexDirection:"row",alignItems:"baseline",borderBottomWidth:1.5,borderBottomColor:C.ink},input:{flex:1,paddingVertical:8,fontSize:19,fontWeight:"800"},suffix:{fontSize:9,fontWeight:"900",color:C.muted},
  button:{minHeight:54,backgroundColor:C.acid,borderWidth:1,borderColor:C.ink,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},buttonDark:{backgroundColor:C.ink},buttonText:{fontSize:13,fontWeight:"900",letterSpacing:.8},buttonTextDark:{color:C.white},pressed:{opacity:.72,transform:[{scale:.99}]},planCard:{backgroundColor:C.acid,borderWidth:1,borderColor:C.ink,padding:16,gap:16},cardLabel:{fontSize:10,fontWeight:"900",letterSpacing:1.5},timeGrid:{flexDirection:"row",alignItems:"stretch"},time:{flex:1,padding:12,backgroundColor:C.white,borderWidth:1,borderColor:C.ink},timeAccent:{backgroundColor:C.orange},timeLabel:{fontSize:10,fontWeight:"900",letterSpacing:1.5},timeValue:{fontSize:30,fontWeight:"900",letterSpacing:-2},arrow:{alignSelf:"center",marginHorizontal:5},reason:{fontSize:13,lineHeight:19,fontWeight:"700"},
  history:{borderTopWidth:2,borderTopColor:C.ink,paddingTop:12,gap:4},historyRow:{height:44,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:C.line},index:{width:30,fontSize:10,color:C.muted},date:{flex:1,fontSize:13,fontWeight:"800"},historyTime:{fontSize:20,fontWeight:"900"},
  alarm:{flex:1,backgroundColor:C.ink,alignItems:"center",paddingHorizontal:24,paddingVertical:50},alarmKicker:{color:C.orange,fontSize:14,fontWeight:"900",letterSpacing:4},alarmTime:{color:C.white,fontSize:88,lineHeight:100,fontWeight:"900",letterSpacing:-7,marginTop:35},rule:{width:"100%",height:1,backgroundColor:"#3C3C3C",marginVertical:24},alarmOut:{color:C.acid,fontSize:28,fontWeight:"900"},alarmEvent:{color:"#9E9E9E",fontSize:13,fontWeight:"700",marginTop:10},stop:{marginTop:"auto",width:"100%",height:72,backgroundColor:C.orange,flexDirection:"row",gap:12,alignItems:"center",justifyContent:"center"},stopText:{fontSize:19,fontWeight:"900",letterSpacing:1},
  timer:{flex:1,padding:22,alignItems:"center"},timerLabel:{fontSize:11,fontWeight:"900",letterSpacing:2.4,marginTop:28},timerValue:{fontSize:82,lineHeight:94,fontWeight:"900",letterSpacing:-5},countdown:{width:"100%",backgroundColor:C.acid,borderWidth:1,borderColor:C.ink,padding:18,alignItems:"center",marginTop:12},urgent:{backgroundColor:C.orange},countdownLabel:{fontSize:10,fontWeight:"900",letterSpacing:2},countdownValue:{fontSize:44,fontWeight:"900",letterSpacing:-2},coach:{fontSize:14,lineHeight:20,fontWeight:"800",textAlign:"center",marginTop:8},timeline:{width:"100%",flexDirection:"row",alignItems:"center",marginTop:22},timelineText:{fontSize:10,fontWeight:"900"},timelineLine:{flex:1,height:1,backgroundColor:C.ink,marginHorizontal:10},out:{marginTop:"auto",width:"100%",height:78,backgroundColor:C.acid,borderWidth:1,borderColor:C.ink,flexDirection:"row",gap:12,alignItems:"center",justifyContent:"center"},outText:{fontSize:25,fontWeight:"900",letterSpacing:1},skip:{padding:16},skipText:{fontSize:10,color:C.muted,fontWeight:"800",textDecorationLine:"underline"},
  result:{padding:20,paddingBottom:60,gap:14},resultTitle:{fontSize:48,lineHeight:50,fontWeight:"900",letterSpacing:-3},proof:{width:"100%",aspectRatio:4/5,backgroundColor:"#333",overflow:"hidden"},placeholder:{backgroundColor:"#333"},shade:{...StyleSheet.absoluteFillObject,backgroundColor:"rgba(0,0,0,.3)"},overlay:{position:"absolute",left:18,right:18,bottom:18},proofBrand:{color:C.acid,fontSize:25,fontWeight:"900"},proofTime:{color:C.white,fontSize:66,lineHeight:72,fontWeight:"900",letterSpacing:-5},proofDuration:{color:C.white,fontSize:12,fontWeight:"800",letterSpacing:1},metrics:{flexDirection:"row",gap:8},metric:{flex:1,minHeight:86,borderWidth:1,borderColor:C.ink,backgroundColor:C.white,padding:12,justifyContent:"space-between"},metricLabel:{fontSize:9,color:C.muted,fontWeight:"900",letterSpacing:1},metricValue:{fontSize:20,fontWeight:"900"},metricGood:{color:"#527A00"},insight:{backgroundColor:C.ink,color:C.white,padding:16,fontSize:14,lineHeight:20,fontWeight:"700"},
});
