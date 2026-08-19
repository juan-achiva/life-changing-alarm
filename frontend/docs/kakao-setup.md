# Kakao Login Setup

## 1. Kakao Developers 앱 준비

1. Kakao Developers에서 앱을 생성한다.
2. `Kakao Login`을 `ON`으로 켠다.
3. Redirect URI에 아래 주소를 등록한다.

`https://todaygrace-juan.web.app/kakao-bridge.html`

## 2. 동의항목 설정

`Kakao Login > Consent items`에서 아래 항목을 켠다.

- `Nickname`
- `Email`

이 앱은 닉네임은 바로 쓰고, 이메일은 있으면 저장하는 구조다.

## 3. 앱 키 복사

`App > Platform key > REST API key`에서 아래 값을 확인한다.

- `REST API key`
- `Client secret`

## 4. 로컬 env 반영

`.env`에 아래 값을 넣는다.

```env
EXPO_PUBLIC_KAKAO_REST_API_KEY=여기에_REST_API_KEY
EXPO_PUBLIC_KAKAO_REDIRECT_BRIDGE_URI=https://todaygrace-juan.web.app/kakao-bridge.html
```

## 5. Functions 시크릿 반영

카카오 클라이언트 시크릿은 프론트에 넣지 않고 Functions 시크릿으로 올린다.

```bash
firebase functions:secrets:set KAKAO_REST_API_KEY
firebase functions:secrets:set KAKAO_CLIENT_SECRET
```

## 6. Expo 재시작

env를 바꾼 뒤에는 Expo 서버를 다시 시작해야 한다.

## 7. 참고

- Kakao Developers에는 브리지 주소만 등록하면 된다.
- Expo Go의 `exp://...` 주소는 앱이 자동으로 전달받는다.
- Apple 로그인은 iPhone Expo Go에서 바로 테스트할 수 있고, 나중에 배포 빌드에서는 Apple Developer 쪽 capability 연결이 추가로 필요하다.
