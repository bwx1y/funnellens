import {AdAccountRepository} from "@db/repositories/ad-account.repository";
import {TenantRepository} from "@db/repositories/tenant.repository";
import {UnauthorizedError} from "@shared/errors";
import {MIN_COMPARATORS} from "@shared/creative";
import {DEFAULT_PAGE_SIZE} from "@shared/audience";
import {PERIOD_DAYS} from "@shared/period";
import {MAX_SEARCH_RESULTS} from "@/modules/search/service";
import {SourcesService} from "@/modules/sources/service";
import type {SettingsResponse} from "@/modules/settings/schema";

/**
 * The backend reads Meta and WhatsApp data and never writes to either platform, so the workspace is
 * read-only by construction. The reason string is what the client shows next to a disabled control.
 */
const READ_ONLY_REASON = "analytics-only";

/**
 * Workspace settings. The source list is not assembled here: `SourcesService` owns that, and this
 * endpoint maps its views into the settings shape so the two pages cannot disagree.
 */
export class SettingsService {
    constructor(
        private readonly tenantRepo = new TenantRepository(),
        private readonly adAccountRepo = new AdAccountRepository(),
        private readonly sources = new SourcesService()
    ) {}

    async get(tenantId: string): Promise<SettingsResponse> {
        const tenant = await this.tenantRepo.findOneById(tenantId);
        if (tenant === null) throw new UnauthorizedError("Workspace tidak ditemukan");

        const [selected, sources] = await Promise.all([
            this.adAccountRepo.findSelectedByTenantId(tenantId),
            this.sources.snapshot(tenantId),
        ]);

        return {
            workspace: {
                id: tenant.id,
                name: tenant.name,
                address: tenant.address,
                // A tenant without a selected account has no timezone or currency yet; guessing
                // "Asia/Jakarta" would let the client format numbers in the wrong zone.
                timezone: selected?.timezoneName ?? null,
                currency: selected?.currency ?? null,
                currencyOffset: selected?.currencyOffset ?? null,
            },
            mode: {readOnly: true, reason: READ_ONLY_REASON},
            sources: sources.map((source) => ({
                key: source.key,
                label: source.label,
                status: source.status,
                lastSyncAt: source.lastSyncAt,
                lastError: source.lastError,
                detailRoute: source.detailRoute,
            })),
            limits: {
                maxComparisonCreatives: MIN_COMPARATORS,
                maxSearchResults: MAX_SEARCH_RESULTS,
                defaultPageSize: DEFAULT_PAGE_SIZE,
                periodDays: [...PERIOD_DAYS],
            },
            exportAuditEnabled: true,
        };
    }
}
