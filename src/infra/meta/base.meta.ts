import type {
    MetaAdAccountDto,
    MetaAdCreativeDto,
    MetaAdDto,
    MetaAdInsightBreakdownDailyDto,
    MetaAdInsightDailyDto,
    MetaAdSetDto,
    MetaAdStudyDto,
    MetaCampaignDto,
    MetaCustomPeriodMetricsDto,
    MetaVideoDto,
} from "./types";

export interface IMetaAdsAdapter {
    getAdAccounts(accessToken: string, options?: { includeBusiness?: boolean }): Promise<MetaAdAccountDto[]>;
    getCampaigns(accessToken: string, accountId: string): Promise<MetaCampaignDto[]>;
    getAdSets(accessToken: string, accountId: string): Promise<MetaAdSetDto[]>;
    getAdCreatives(accessToken: string, accountId: string): Promise<MetaAdCreativeDto[]>;
    getAds(accessToken: string, accountId: string): Promise<MetaAdDto[]>;
    getVideoDetails(accessToken: string, videoId: string): Promise<MetaVideoDto | null>;
    getDailyAdInsights(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currency?: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightDailyDto[]>;
    getDailyAdBreakdowns(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightBreakdownDailyDto[]>;
    getHourlyAdBreakdowns(
        accessToken: string,
        accountId: string,
        options: {
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaAdInsightBreakdownDailyDto[]>;
    getCustomPeriodMetrics(
        accessToken: string,
        accountId: string,
        options: {
            level: "account" | "campaign" | "adset" | "ad";
            entityId?: string;
            since: string;
            until: string;
            currencyOffset?: number;
        }
    ): Promise<MetaCustomPeriodMetricsDto | null>;
}

/**
 * Kept apart from `IMetaAdsAdapter` on purpose: three unit-test doubles implement the ads adapter and
 * would break on a new member that has nothing to do with account-scoped insights.
 */
export interface IMetaAdStudiesAdapter {
    /** Missing permission → `{hasAccess: false, studies: []}`; every other failure is thrown. */
    getAdStudies(accessToken: string, metaUserId: string): Promise<{hasAccess: boolean; studies: MetaAdStudyDto[]}>;
}
