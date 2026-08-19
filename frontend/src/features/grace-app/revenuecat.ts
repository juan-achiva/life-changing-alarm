import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";

export type GroupUpgradeOffer = {
  identifier: string;
  title: string;
  priceLabel: string;
  periodLabel: string;
};

export type GroupUpgradeState = {
  supported: boolean;
  configured: boolean;
  entitlementActive: boolean;
  offer: GroupUpgradeOffer | null;
  managementUrl: string | null;
  message: string | null;
};

const entitlementId = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() ?? "";
const appleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? "";
const googleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY?.trim() ?? "";

export const defaultGroupUpgradeState: GroupUpgradeState = {
  supported: true,
  configured: false,
  entitlementActive: false,
  offer: null,
  managementUrl: null,
  message: "RevenueCat 설정을 연결하면 실제 구독 결제를 시작할 수 있어요.",
};

let purchasesModulePromise:
  | Promise<typeof import("react-native-purchases")["default"]>
  | null = null;

export async function loadGroupUpgradeState(appUserId: string): Promise<GroupUpgradeState> {
  const supportState = getRevenueCatSupportState();
  if (!supportState.supported || !supportState.configured) {
    return supportState;
  }

  await ensureRevenueCatConfigured(appUserId);
  const purchases = await getPurchasesModule();

  let offerings: PurchasesOfferings;
  let customerInfo: CustomerInfo;

  try {
    [offerings, customerInfo] = await Promise.all([
      purchases.getOfferings(),
      purchases.getCustomerInfo(),
    ]);
  } catch (error) {
    throw createRevenueCatDebugError(error);
  }

  return buildGroupUpgradeState(offerings, customerInfo);
}

export async function purchaseGrowthPlan(appUserId: string) {
  const supportState = getRevenueCatSupportState();
  if (!supportState.supported || !supportState.configured) {
    throw new Error(supportState.message ?? "구독 결제를 시작할 수 없어요.");
  }

  await ensureRevenueCatConfigured(appUserId);
  const purchases = await getPurchasesModule();

  let offerings: PurchasesOfferings;

  try {
    offerings = await purchases.getOfferings();
  } catch (error) {
    throw createRevenueCatDebugError(error);
  }

  const selectedPackage = pickPreferredPackage(offerings);

  if (!selectedPackage) {
    throw new Error(buildMissingOfferingMessage(offerings));
  }

  const result = await purchases.purchasePackage(selectedPackage);

  return {
    customerInfo: result.customerInfo,
    state: buildGroupUpgradeState(offerings, result.customerInfo),
  };
}

export async function restoreGrowthPlan(appUserId: string) {
  const supportState = getRevenueCatSupportState();
  if (!supportState.supported || !supportState.configured) {
    throw new Error(supportState.message ?? "구독 복원을 시작할 수 없어요.");
  }

  await ensureRevenueCatConfigured(appUserId);
  const purchases = await getPurchasesModule();

  let offerings: PurchasesOfferings;
  let customerInfo: CustomerInfo;

  try {
    [offerings, customerInfo] = await Promise.all([
      purchases.getOfferings(),
      purchases.restorePurchases(),
    ]);
  } catch (error) {
    throw createRevenueCatDebugError(error);
  }

  return {
    customerInfo,
    state: buildGroupUpgradeState(offerings, customerInfo),
  };
}

export async function resetRevenueCatSession() {
  if (isExpoGo()) {
    return;
  }

  const purchases = await getPurchasesModule();

  try {
    await purchases.getAppUserID();
  } catch {
    return;
  }

  await purchases.logOut().catch(() => undefined);
}

export function isPurchaseCancelledError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "userCancelled" in error &&
      (error as { userCancelled?: boolean }).userCancelled,
  );
}

function getRevenueCatSupportState(): GroupUpgradeState {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return {
      ...defaultGroupUpgradeState,
      supported: false,
      message: "구독 결제는 iPhone이나 Android 앱에서만 사용할 수 있어요.",
    };
  }

  if (Platform.OS === "android") {
    return {
      ...defaultGroupUpgradeState,
      supported: false,
      configured: false,
      message: "안드로이드 공동체 확장 기능은 차후에 진행할 기능입니다.",
    };
  }

  if (isExpoGo()) {
    return {
      ...defaultGroupUpgradeState,
      supported: false,
      message: "실제 구독 결제 테스트는 Expo Go가 아니라 개발 빌드에서 할 수 있어요.",
    };
  }

  if (!getRevenueCatPublicApiKey()) {
    return {
      ...defaultGroupUpgradeState,
      configured: false,
      message: "RevenueCat public SDK key를 먼저 연결해 주세요.",
    };
  }

  if (!entitlementId) {
    return {
      ...defaultGroupUpgradeState,
      configured: false,
      message: "RevenueCat entitlement ID를 먼저 연결해 주세요.",
    };
  }

  return {
    ...defaultGroupUpgradeState,
    supported: true,
    configured: true,
    message: null,
  };
}

async function ensureRevenueCatConfigured(appUserId: string) {
  const apiKey = getRevenueCatPublicApiKey();

  if (!apiKey) {
    throw new Error("RevenueCat public SDK key가 아직 없어요.");
  }

  const purchases = await getPurchasesModule();
  const infoLogLevel = "INFO" as Parameters<typeof purchases.setLogLevel>[0];

  await purchases.setLogLevel(infoLogLevel).catch(() => undefined);

  let currentAppUserId: string | null = null;

  try {
    currentAppUserId = await purchases.getAppUserID();
  } catch {
    currentAppUserId = null;
  }

  if (!currentAppUserId) {
    purchases.configure({
      apiKey,
      appUserID: appUserId,
    });
    return;
  }

  if (currentAppUserId !== appUserId) {
    await purchases.logIn(appUserId);
  }
}

async function getPurchasesModule() {
  if (isExpoGo()) {
    throw new Error("실제 구독 결제 테스트는 Expo Go가 아니라 개발 빌드에서 할 수 있어요.");
  }

  if (!purchasesModulePromise) {
    purchasesModulePromise = import("react-native-purchases").then((module) => module.default);
  }

  return purchasesModulePromise;
}

function buildGroupUpgradeState(offerings: PurchasesOfferings, customerInfo: CustomerInfo): GroupUpgradeState {
  const selectedPackage = pickPreferredPackage(offerings);
  const entitlementActive = Boolean(customerInfo.entitlements.active[entitlementId]?.isActive);

  return {
    supported: true,
    configured: true,
    entitlementActive,
    offer: selectedPackage ? mapOffer(selectedPackage) : null,
    managementUrl: customerInfo.managementURL,
    message: selectedPackage
      ? entitlementActive
        ? "확장 플랜이 연결되어 있어서 최대 20명까지 함께할 수 있어요."
        : null
      : buildMissingOfferingMessage(offerings),
  };
}

function pickPreferredPackage(offerings: PurchasesOfferings) {
  const candidates = [
    ...(offerings.current ? [offerings.current] : []),
    ...Object.values(offerings.all).filter(
      (offering): offering is NonNullable<typeof offering> =>
        Boolean(offering) && offering.identifier !== offerings.current?.identifier,
    ),
  ];

  for (const offering of candidates) {
    const selected =
      offering.monthly ??
      offering.annual ??
      offering.sixMonth ??
      offering.threeMonth ??
      offering.weekly ??
      offering.availablePackages[0] ??
      null;

    if (selected) {
      return selected;
    }
  }

  return null;
}

function mapOffer(aPackage: PurchasesPackage): GroupUpgradeOffer {
  return {
    identifier: aPackage.identifier,
    title: aPackage.product.title,
    priceLabel: aPackage.product.priceString,
    periodLabel: formatPackagePeriod(aPackage),
  };
}

function formatPackagePeriod(aPackage: PurchasesPackage) {
  switch (aPackage.packageType) {
    case "MONTHLY":
      return "월간 구독";
    case "ANNUAL":
      return "연간 구독";
    case "SIX_MONTH":
      return "6개월 구독";
    case "THREE_MONTH":
      return "3개월 구독";
    case "WEEKLY":
      return "주간 구독";
    case "LIFETIME":
      return "평생 이용";
    default:
      return "확장 플랜";
  }
}

function buildMissingOfferingMessage(offerings: PurchasesOfferings) {
  const offeringIds = Object.keys(offerings.all);
  const packageIds = offeringIds.flatMap((offeringId) =>
    offerings.all[offeringId]?.availablePackages.map(
      (aPackage) => `${offeringId}:${aPackage.identifier}:${aPackage.product.identifier}`,
    ) ?? [],
  );

  return [
    "RevenueCat에 현재 offering이 아직 연결되지 않았어요.",
    createRevenueCatDebugSuffix({
      currentOfferingId: offerings.current?.identifier ?? null,
      offeringIds,
      packageIds,
    }),
  ].join("\n");
}

function createRevenueCatDebugError(error: unknown) {
  const baseMessage =
    error instanceof Error ? error.message : "RevenueCat 설정 확인 중 오류가 발생했어요.";

  return new Error([baseMessage, createRevenueCatDebugSuffix()].join("\n"));
}

function createRevenueCatDebugSuffix({
  currentOfferingId,
  offeringIds,
  packageIds,
}: {
  currentOfferingId?: string | null;
  offeringIds?: string[];
  packageIds?: string[];
} = {}) {
  const bundleId =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package;

  const parts = [
    `key=${maskPublicApiKey(getRevenueCatPublicApiKey())}`,
    `entitlement=${entitlementId || "missing"}`,
    `bundle=${bundleId || "unknown"}`,
  ];

  if (currentOfferingId !== undefined) {
    parts.push(`current=${currentOfferingId || "none"}`);
  }

  if (offeringIds) {
    parts.push(`offerings=${offeringIds.length ? offeringIds.join(",") : "none"}`);
  }

  if (packageIds) {
    parts.push(`packages=${packageIds.length ? packageIds.join(",") : "none"}`);
  }

  return `[RevenueCat debug] ${parts.join(" | ")}`;
}

function maskPublicApiKey(apiKey: string | null) {
  if (!apiKey) {
    return "missing";
  }

  if (apiKey.length <= 12) {
    return apiKey;
  }

  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

function getRevenueCatPublicApiKey() {
  if (Platform.OS === "ios") {
    return appleApiKey || null;
  }

  if (Platform.OS === "android") {
    return googleApiKey || null;
  }

  return null;
}

function isExpoGo() {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === "expo"
  );
}
