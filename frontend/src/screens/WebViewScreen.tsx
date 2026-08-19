import React, { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useWebViewBridge } from '../hooks/useWebViewBridge';

// React.FC는 이 함수가 리액트 함수형 컴포넌트임을 명시
const WebViewScreen: React.FC = () => {
  
  const webViewRef = useRef<WebView>(null);
  const myWebsiteUrl = 'https://www.iworkouttoday.com/?is_app=true';
  
  // webViewRef를 넘겨주고, onmessage 수신
  const { onMessage } = useWebViewBridge(webViewRef);

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        ref={webViewRef} 
        source={{ uri: myWebsiteUrl }}
        style={styles.webview}
        onMessage={onMessage} 
        javaScriptEnabled={true} 
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  webview: { 
    flex: 1,
  },
});

export default WebViewScreen;