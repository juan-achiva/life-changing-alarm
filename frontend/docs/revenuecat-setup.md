# RevenueCat 결제 연결

`오늘 은혜`에서 8명 이상 공동체 확장 플랜을 결제로 열려면 아래 3가지를 먼저 준비해야 합니다.

## 1. RevenueCat 앱 만들기

1. RevenueCat 대시보드에서 iOS 앱과 Android 앱을 추가합니다.
2. 각 스토어 상품을 RevenueCat Product로 연결합니다.
3. Current Offering을 하나 만들고, 월간 또는 연간 패키지를 연결합니다.
4. Entitlement를 하나 만들고, 예를 들어 `growth_group` 같은 ID를 사용합니다.

## 2. 환경변수 채우기

아래 값을 `.env`에 넣습니다.

```env
EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=appl_xxxxx
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=goog_xxxxx
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=growth_group
```

## 3. 테스트 방식

- `Expo Go`에서는 실제 인앱결제를 테스트할 수 없습니다.
- `EAS development build` 또는 스토어 테스트 빌드에서 확인해야 합니다.
- 오너가 결제를 완료하거나 복원하면 공동체 최대 인원이 `20명`으로 올라갑니다.

## 현재 앱 동작

- 무료 플랜: 최대 `7명`
- 확장 플랜: 최대 `20명`
- 결제 버튼은 그룹 오너만 볼 수 있습니다.
- 활성 구독이 있으면 공동체가 자동으로 확장 플랜으로 동기화됩니다.
