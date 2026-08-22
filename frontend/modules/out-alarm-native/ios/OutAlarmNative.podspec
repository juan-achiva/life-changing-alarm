Pod::Spec.new do |s|
  s.name           = 'OutAlarmNative'
  s.version        = '1.0.0'
  s.summary        = 'Native wake and target-out alarms for OUT.'
  s.description    = 'Expo local module backed by AlarmKit on supported iOS versions.'
  s.license        = { :type => 'MIT' }
  s.author         = { 'OUT' => 'dev@out.app' }
  s.homepage       = 'https://github.com/juan-achiva/life-changing-alarm'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/juan-achiva/life-changing-alarm.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'AlarmKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
