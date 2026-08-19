# Auth Backend

## 목적

- Apple 로그인과 Kakao 로그인을 Firebase Auth의 실제 사용자 세션으로 연결한다.
- 앱 클라이언트는 소셜 로그인 결과를 Functions에 전달하고, Functions가 검증 후 Firebase custom token을 발급한다.
- Firestore와 Storage 규칙은 `request.auth.uid` 기준으로 동작한다.

## Functions

- `exchangeKakaoCode`
  - Kakao 인가 코드를 받아 액세스 토큰 교환
  - Kakao 사용자 정보 검증
  - Firebase custom token 발급
- `exchangeAppleIdentityToken`
  - Apple identity token 서명 검증
  - Firebase custom token 발급

## 필요한 시크릿

```bash
firebase functions:secrets:set KAKAO_REST_API_KEY
firebase functions:secrets:set KAKAO_CLIENT_SECRET
```

## 배포

```bash
firebase deploy --only functions
```

## 현재 uid 규칙

- Kakao: `kakao:{providerUserId}`
- Apple: `apple:{providerUserId}`

이 uid가 그대로 Firestore `users/{uid}` 문서 키와 Storage 업로드 권한 기준이 된다.
