import ExpoModulesCore
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI
#endif

struct NativeAlarmRequest: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var timestamp: Double = 0
  @Field var kind: String = "wake-alarm"
  @Field var planId: String = ""
  @Field var soundEnabled: Bool = true
  @Field var vibrationEnabled: Bool = true
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
private struct OutAlarmMetadata: AlarmMetadata {
  let planId: String
  let kind: String
}

@available(iOS 26.0, *)
private struct OutAlarmStopIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "기상 완료"
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Plan ID") var planId: String
  @Parameter(title: "Alarm kind") var kind: String

  init() {
    planId = ""
    kind = ""
  }

  init(planId: String, kind: String) {
    self.planId = planId
    self.kind = kind
  }

  func perform() async throws -> some IntentResult {
    if kind == "wake-alarm" || kind == "last-call" {
      UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: "out.pendingWakeAt")
      UserDefaults.standard.set(planId, forKey: "out.pendingWakePlanId")
      UserDefaults.standard.set(kind, forKey: "out.pendingAlarmKind")
    }
    return .result()
  }
}
#endif

public final class OutAlarmNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OutAlarmNative")
    AsyncFunction("isSupported") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }
    AsyncFunction("requestAuthorization") { () async throws -> String in
      guard #available(iOS 26.0, *) else { return "unsupported" }
      #if canImport(AlarmKit)
      switch try await AlarmManager.shared.requestAuthorization() {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unknown"
      }
      #else
      return "unsupported"
      #endif
    }
    AsyncFunction("canScheduleExactAlarms") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }
    AsyncFunction("openExactAlarmSettings") { () in }
    AsyncFunction("consumePendingAlarm") { (planId: String) -> [String: Any]? in
      let defaults = UserDefaults.standard
      guard defaults.string(forKey: "out.pendingWakePlanId") == planId else { return nil }
      let wakeAt = defaults.double(forKey: "out.pendingWakeAt")
      let kind = defaults.string(forKey: "out.pendingAlarmKind") ?? "wake-alarm"
      defaults.removeObject(forKey: "out.pendingWakeAt")
      defaults.removeObject(forKey: "out.pendingWakePlanId")
      defaults.removeObject(forKey: "out.pendingAlarmKind")
      return wakeAt > 0 ? ["timestamp": wakeAt, "kind": kind] : nil
    }
    AsyncFunction("schedule") { (request: NativeAlarmRequest) async throws -> [String: String] in
      guard #available(iOS 26.0, *) else { throw GenericException("AlarmKit requires iOS 26 or later") }
      #if canImport(AlarmKit)
      guard request.soundEnabled else { throw GenericException("Silent alarms use the notification fallback") }
      guard let alarmID = UUID(uuidString: request.id) else { throw GenericException("Invalid native alarm identifier") }
      guard AlarmManager.shared.authorizationState == .authorized else { throw GenericException("AlarmKit permission is not authorized") }
      let stopButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "기상 완료"),
        textColor: .white,
        systemImageName: "stop.fill"
      )
      let presentation = AlarmPresentation(
        alert: AlarmPresentation.Alert(
          title: LocalizedStringResource(stringLiteral: request.title),
          stopButton: stopButton
        )
      )
      let attributes = AlarmAttributes(presentation: presentation, metadata: OutAlarmMetadata(planId: request.planId, kind: request.kind), tintColor: Color(red: 0.85, green: 1.0, blue: 0.26))
      let configuration = AlarmManager.AlarmConfiguration<OutAlarmMetadata>.alarm(
        schedule: .fixed(Date(timeIntervalSince1970: request.timestamp / 1000)),
        attributes: attributes,
        stopIntent: OutAlarmStopIntent(planId: request.planId, kind: request.kind),
        sound: .default
      )
      _ = try await AlarmManager.shared.schedule(id: alarmID, configuration: configuration)
      return ["id": alarmID.uuidString]
      #else
      throw GenericException("AlarmKit is unavailable in this SDK")
      #endif
    }
    AsyncFunction("cancelAll") { () throws in
      guard #available(iOS 26.0, *) else { return }
      #if canImport(AlarmKit)
      for alarm in try AlarmManager.shared.alarms { try AlarmManager.shared.cancel(id: alarm.id) }
      #endif
    }
  }
}
