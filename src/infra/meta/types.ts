export interface MetaAdAccountDto {
    id: string;
    name: string;
    currency: string;
    currencyOffset: number;
    timezoneName: string;
    accountStatus: number | null;
    businessId: string | null;
}

export interface MetaCampaignDto {
    id: string;
    name: string;
    objective: string | null;
    status: string | null;
    effectiveStatus: string | null;
    buyingType: string | null;
    dailyBudgetMinor: number | null;
    lifetimeBudgetMinor: number | null;
    budgetRemainingMinor: number | null;
    startTime: Date | null;
    stopTime: Date | null;
    createdTime: Date | null;
    updatedTime: Date | null;
    raw: Record<string, unknown>;
}

export interface MetaAdSetDto {
    id: string;
    name: string;
    campaignId: string;
    status: string | null;
    effectiveStatus: string | null;
    optimizationGoal: string | null;
    destinationType: string | null;
    billingEvent: string | null;
    bidStrategy: string | null;
    bidAmountMinor: number | null;
    dailyBudgetMinor: number | null;
    lifetimeBudgetMinor: number | null;
    targeting: Record<string, unknown> | null;
    startTime: Date | null;
    endTime: Date | null;
    createdTime: Date | null;
    updatedTime: Date | null;
    raw: Record<string, unknown>;
}

export interface MetaAdCreativeDto {
    id: string;
    name: string | null;
    objectType: string | null;
    status: string | null;
    videoId: string | null;
    videoLengthSeconds: string | null;
    videoPermalinkUrl: string | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    objectStoryId: string | null;
    body: string | null;
    title: string | null;
    callToActionType: string | null;
    urlTags: string | null;
    createdTime: Date | null;
    updatedTime: Date | null;
    raw: Record<string, unknown>;
}

export interface MetaAdDto {
    id: string;
    name: string;
    campaignId: string;
    adsetId: string;
    creativeId: string | null;
    status: string | null;
    effectiveStatus: string | null;
    createdTime: Date | null;
    updatedTime: Date | null;
    raw: Record<string, unknown>;
}

export interface MetaVideoDto {
    id: string;
    length: number | null;
    permalinkUrl: string | null;
}

export interface MetaAdInsightActionDto {
    actionType: string;
    count: string;
    valueMinor: number | null;
    costPerActionMinor: number | null;
}

export interface MetaAdInsightDailyDto {
    accountId: string;
    level: "ad" | "adset" | "campaign" | "account";
    entityId: string;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
    date: string;
    attributionWindow: string;
    currency: string;
    currencyOffset: number;
    spendMinor: number;
    impressions: number;
    reach: number | null;
    frequency: string | null;
    clicks: number;
    inlineLinkClicks: number | null;
    uniqueClicks: number | null;
    ctr: string | null;
    cpcMinor: number | null;
    cpmMinor: number | null;
    actions: unknown;
    actionValues: unknown;
    costPerActionType: unknown;
    videoPlayActions: number | null;
    video30SecWatchedActions: number | null;
    videoThruplayWatchedActions: number | null;
    videoP25WatchedActions: number | null;
    videoP50WatchedActions: number | null;
    videoP75WatchedActions: number | null;
    videoP100WatchedActions: number | null;
    videoAvgTimeWatchedSeconds: string | null;
    graphVersion: string;
    actionReportTime: string;
    video3SecWatchedActions: number | null;
    isFinal: boolean;
    extractedActions: MetaAdInsightActionDto[];
}

export interface MetaAdInsightBreakdownDailyDto {
    accountId: string;
    level: "ad" | "adset" | "campaign" | "account";
    entityId: string;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
    date: string;
    attributionWindow: string;
    publisherPlatform: string | null;
    platformPosition: string | null;
    impressionDevice: string | null;
    hourOfDay: number | null;
    age: string | null;
    gender: string | null;
    country: string | null;
    region: string | null;
    breakdownHash: string;
    spendMinor: number;
    impressions: number;
    reach: number | null;
    clicks: number;
    inlineLinkClicks: number | null;
    actions: unknown;
    actionValues: unknown;
}

export interface MetaCustomPeriodMetricsDto {
    accountId: string;
    level: "account" | "campaign" | "adset" | "ad";
    entityId: string;
    since: string;
    until: string;
    reach: number;
    frequency: string;
    impressions: number;
    spendMinor: number;
    clicks: number;
    raw: Record<string, unknown>;
}
