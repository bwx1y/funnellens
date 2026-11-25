import type {SourceStatus} from "@shared/sources";

/**
 * `GET /api/settings` takes no query: the workspace is resolved from the bearer token alone. The
 * response contract lives here so the controller and the service share one shape.
 */
export type SettingsSourceStatus = SourceStatus;

export interface SettingsSource {
    key: "meta" | "whatsapp";
    label: string;
    status: SettingsSourceStatus;
    lastSyncAt: string | null;
    lastError: string | null;
    detailRoute: string;
}

export interface SettingsResponse {
    workspace: {
        id: string;
        name: string;
        address: string | null;
        timezone: string | null;
        currency: string | null;
        currencyOffset: number | null;
    };
    mode: {readOnly: true; reason: string};
    sources: SettingsSource[];
    limits: {
        maxComparisonCreatives: number;
        maxSearchResults: number;
        defaultPageSize: number;
        periodDays: number[];
    };
    exportAuditEnabled: boolean;
}
