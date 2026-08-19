import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { MutableRefObject, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

type WvConsoleMessage = {
  __wv_console__: true;
  type: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: any[];
};

type LoginSuccessMessage = {
  type: 'LOGIN_SUCCESS';
  linkToken: string;
};

type RequestCameraMessage = { type: 'REQUEST_CAMERA' };

type WebToAppMessage = WvConsoleMessage | LoginSuccessMessage | RequestCameraMessage;

type AppToWebMessage =
  | { type: 'IMAGE_DATA'; data: string }
  | { type: 'PUSH_LINKED'; ok: true }
  | { type: 'PUSH_LINK_ERROR'; ok: false; reason: string }
  | { type: 'PUSH_REGISTERED'; ok: true }
  | { type: 'PUSH_REGISTER_ERROR'; ok: false; reason: string };

type WebViewRef = MutableRefObject<WebView | null>;

// ✅ 백엔드가 Next.js 안에 있으면 웹 도메인, 별도 API면 api 도메인
const API_BASE = 'https://container-service-1.wffkggdq3jc9m.ap-northeast-2.cs.amazonlightsail.com';

// ✅ 지금 상황(1회용 토큰 소비 의심)에서는 link-verify를 기본 OFF 권장
const ENABLE_LINK_VERIFY = false;

function getProjectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ||
    (Constants.expoConfig as any)?.extra?.eas?.projectId ||
    undefined
  );
}

// ✅ 백엔드 명세가 deviceInfo: "android/ios/" 로 써있어서 일단 그 형태로 맞춰 보냄
function getDeviceInfo(): string {
  // 필요하면 백엔드와 합의해서 "ios" | "android" 로 바꾸는 게 깔끔함
  return Platform.OS === 'ios' ? 'ios/' : 'android/';
}

export function useWebViewBridge(webViewRef: WebViewRef) {
  // "한 번만" 처리하되, 실패하면 재시도 가능하도록 설계
  const inFlightRef = useRef(false);

  const postMessageToWeb = (message: AppToWebMessage) => {
    if (!webViewRef.current) return;
    const script = `
      window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(message)} }));
      true;
    `;
    webViewRef.current.injectJavaScript(script);
  };

  const verifyLinkToken = async (linkToken: string) => {
    const res = await fetch(`${API_BASE}/api/push/link-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkToken }),
    });

    const text = await res.text().catch(() => '');
    console.log('[PUSH] link-verify status:', res.status, 'body:', text);

    if (!res.ok) {
      throw new Error(`verify failed: ${res.status} ${text}`);
    }
  };

  const ensurePushPermissionGranted = async () => {
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;

    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }

    console.log('[PUSH] permission status:', status);

    if (status !== 'granted') {
      throw new Error('push permission not granted');
    }
  };

  const getExpoPushToken = async () => {
    const projectId = getProjectId();
    console.log('[PUSH] projectId:', projectId);

    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const token = tokenRes.data;
    if (!token) throw new Error('failed to get expoPushToken');
    return token; // "ExponentPushToken[...]" 형태
  };

  const registerPushToken = async (linkToken: string, expoPushToken: string) => {
    const deviceInfo = getDeviceInfo();

    // ✅ 요청 바디 로그 (민감정보는 마스킹)
    console.log('[PUSH] register request payload:', {
      linkToken: linkToken.slice(0, 18) + '...',
      expoPushToken,
      deviceInfo,
    });

    const res = await fetch(`${API_BASE}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkToken,
        expoPushToken,
        deviceInfo, // ✅ 명세 필드명 + 값 형태 맞추기
      }),
    });

    // ✅ 여기 반드시 찍어야 함: 백엔드가 PUSH001~005 중 뭘 주는지 확인 가능
    const text = await res.text().catch(() => '');
    console.log('[PUSH] register response:', res.status, text);

    if (!res.ok) {
      throw new Error(`register failed: ${res.status} ${text}`);
    }
  };

  const onMessage = async (event: { nativeEvent: { data: string } }) => {
    try {
      const raw = event.nativeEvent.data;
      const message: any = JSON.parse(raw);

      // (A) 웹 콘솔 미러링
      if (message?.__wv_console__ === true) {
        const m = message as WvConsoleMessage;
        const args = Array.isArray(m.args) ? m.args : [];
        (console[m.type] ?? console.log)('[WEB]', ...args);
        return;
      }

      // (B) 업무 메시지
      const typed = message as WebToAppMessage;
      console.log('Web -> App 메시지 수신:', typed);

      if (typed.type === 'REQUEST_CAMERA') {
        showImagePickerOptions();
        return;
      }

      if (typed.type === 'LOGIN_SUCCESS') {
        // ✅ 중복 실행 방지(동시에 여러 번 들어오는 경우)
        if (inFlightRef.current) return;
        inFlightRef.current = true;

        try {
          if (!typed.linkToken) {
            postMessageToWeb({ type: 'PUSH_LINK_ERROR', ok: false, reason: 'missing linkToken' });
            return;
          }

          // 1) (선택) linkToken 검증
          // ✅ 1회용 토큰 소비(PUSH003) 의심 있으면 우선 끄고 register부터 통과시키는 게 맞음
          if (ENABLE_LINK_VERIFY) {
            await verifyLinkToken(typed.linkToken);
            postMessageToWeb({ type: 'PUSH_LINKED', ok: true });
          }

          // 2) 권한 확인 + 토큰 발급 + 서버 등록
          await ensurePushPermissionGranted();

          const expoPushToken = await getExpoPushToken();
          console.log('[PUSH] expoPushToken:', expoPushToken);

          await registerPushToken(typed.linkToken, expoPushToken);

          postMessageToWeb({ type: 'PUSH_REGISTERED', ok: true });
          console.log('[PUSH] register OK');
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          console.log('[PUSH] flow error:', msg);

          // ✅ 실패하면 재시도 가능하도록 inFlight를 풀어줌
          inFlightRef.current = false;

          postMessageToWeb({
            type: 'PUSH_REGISTER_ERROR',
            ok: false,
            reason: msg,
          });
        }

        return;
      }
    } catch (error) {
      console.error('메시지 처리 중 오류 발생:', error);
    }
  };

  // 이하 카메라 로직(기존 유지)
  const showImagePickerOptions = () => {
    Alert.alert('사진 첨부', '사진을 첨부할 방법을 선택해주세요.', [
      { text: '카메라로 촬영', onPress: () => openCamera() },
      { text: '앨범에서 선택', onPress: () => openImageLibrary() },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '카메라를 사용하려면 권한을 허용해야 합니다.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      allowsEditing: true,
      quality: 0.8,
    });
    handleImageResult(result);
  };

  const openImageLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진첩에 접근하려면 권한을 허용해야 합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      allowsEditing: true,
      quality: 0.8,
    });
    handleImageResult(result);
  };

  const handleImageResult = (result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled) {
      postMessageToWeb({ type: 'IMAGE_DATA', data: result.assets[0].base64 ?? '' });
    }
  };

  return { onMessage };
}
