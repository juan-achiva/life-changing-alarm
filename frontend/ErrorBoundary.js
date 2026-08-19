// ErrorBoundary.js
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // 다음 렌더링에서 폴백 UI가 보이도록 상태를 업데이트 합니다.
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // 에러 리포팅 서비스에 에러를 기록할 수도 있습니다.
    console.log("💥 에러가 발생했습니다! 💥");
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // 에러가 발생했을 때 보여줄 UI를 직접 만들 수 있습니다.
      return (
        <View style={styles.container}>
          <Text style={styles.title}>앗! 문제가 발생했습니다.</Text>
          <Text style={styles.errorText}>
            {this.state.error && this.state.error.toString()}
          </Text>
        </View>
      );
    }

    // 에러가 없다면, 자식 컴포넌트를 그대로 렌더링합니다.
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8d7da'
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    color: '#721c24'
  }
});

export default ErrorBoundary;