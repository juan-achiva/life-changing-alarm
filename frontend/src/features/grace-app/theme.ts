import { Platform } from "react-native";

export const theme = {
  colors: {
    backgroundPrimary: "#F8F4EA",
    backgroundSecondary: "#FFFDFC",
    surfaceCard: "#FFF9F0",
    surfaceSoft: "#F3DFC2",
    textPrimary: "#2E2A24",
    textSecondary: "#5D5849",
    textTertiary: "#7F7A68",
    accentPrimary: "#D89A5B",
    accentPressed: "#C48749",
    accentSoft: "#F5E7D3",
    lineSoft: "#E7DDCC",
    success: "#6E8B5B",
    danger: "#A45743",
    white: "#FFFDF9",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  radius: {
    sm: 14,
    md: 16,
    lg: 24,
    xl: 28,
    pill: 999,
  },
  shadow: {
    card: {
      shadowColor: "#54432A",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 4,
    },
    floating: {
      shadowColor: "#54432A",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.14,
      shadowRadius: 30,
      elevation: 6,
    },
  },
  fonts: {
    display: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
    body: Platform.select({
      ios: "System",
      android: "sans-serif",
      default: "System",
    }),
  },
} as const;
