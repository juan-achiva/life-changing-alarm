import { createStackNavigator } from '@react-navigation/stack';
import React from 'react';
import WebViewScreen from '../screens/WebViewScreen';

const Stack = createStackNavigator();

function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainWebView" component={WebViewScreen} />
    </Stack.Navigator>
  );
}

export default AppNavigator;