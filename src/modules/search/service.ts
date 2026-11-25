import {LeadRepository} from "@db/repositories/lead.repository";
import {ConversationMessageRepository} from "@db/repositories/conversation-message.repository";
import {requireAccountScope} from "@db/repositories/ad-account.repository";

/** One app route the global search can jump to. */
export interface SearchPage {
    label: string;
    route: string;
    keywords: string[];
}

export interface SearchLeadRow {
    id: number;
    alias: string | null;
    topic: string | null;
    phoneMasked: string | null;
}

export interface SearchResponse {
    pages: SearchPage[];
    leads: SearchLeadRow[];
    meta: {q: string; truncated: boolean};
}

export interface SearchQuery {
    q?: string;
    accountId?: string;
}

/** Cap per result set, shared with `GET /api/settings` so the documented limit cannot drift. */
export const MAX_SEARCH_RESULTS = 8;
const MIN_QUERY_LENGTH = 2;

/** Static route registry: the app has a fixed set of pages, so no database lookup is needed. */
const PAGES: SearchPage[] = [
    {
        label: "Ringkasan",
        route: "/app/overview",
        keywords: ["ringkasan", "overview", "dasbor", "kpi", "metrik", "belanja"],
    },
    {
        label: "Funnel",
        route: "/app/funnel",
        keywords: ["funnel", "kebocoran", "konversi", "tahap", "leak", "closing"],
    },
    {
        label: "Audiens",
        route: "/app/audience",
        keywords: ["audiens", "lead", "pipeline", "suhu", "hot", "warm", "cold", "respon"],
    },
    {
        label: "Campaign",
        route: "/app/campaigns",
        keywords: ["campaign", "kampanye", "iklan", "anggaran", "roas", "biaya"],
    },
    {
        label: "Kreatif",
        route: "/app/creative",
        keywords: ["kreatif", "creative", "fatigue", "ctr", "hook", "desain"],
    },
    {
        label: "Insight",
        route: "/app/insights",
        keywords: ["insight", "wawasan", "alert", "peringatan", "narasi", "rekomendasi"],
    },
    {
        label: "Tracking",
        route: "/app/tracking",
        keywords: ["tracking", "pixel", "capi", "emq", "dedup", "kesehatan"],
    },
    {
        label: "Integrasi",
        route: "/app/integrations",
        keywords: ["integrasi", "meta", "whatsapp", "koneksi", "akun", "token"],
    },
];

/** Label hits outrank keyword hits; a prefix beats a substring at the same level. */
function pageScore(page: SearchPage, needle: string): number {
    const label = page.label.toLowerCase();
    if (label.startsWith(needle)) return 3;
    if (label.includes(needle)) return 2;

    let score = 0;
    for (const keyword of page.keywords) {
        const value = keyword.toLowerCase();
        if (value.startsWith(needle)) score = Math.max(score, 1.5);
        else if (value.includes(needle)) score = Math.max(score, 1);
    }

    return score;
}

function rankPages(needle: string): SearchPage[] {
    return PAGES
        .map((page) => ({page, score: pageScore(page, needle)}))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.page.label.localeCompare(right.page.label))
        .map((entry) => entry.page);
}

export class SearchService {
    constructor(
        private readonly leadRepo = new LeadRepository(),
        private readonly conversationRepo = new ConversationMessageRepository()
    ) {}

    /**
     * Two independent result sets: the static page registry and the account's leads. A query shorter
     * than two characters never touches the lead table, and leads are only read for an account the
     * tenant owns.
     */
    async search(tenantId: string, query: SearchQuery): Promise<SearchResponse> {
        const q = (query.q ?? "").trim();

        if (q.length < MIN_QUERY_LENGTH) {
            return {
                pages: PAGES.slice(0, MAX_SEARCH_RESULTS),
                leads: [],
                meta: {q, truncated: false},
            };
        }

        const needle = q.toLowerCase();
        const pages = rankPages(needle).slice(0, MAX_SEARCH_RESULTS);
        const leads = query.accountId === undefined
            ? []
            : await this.searchLeads(tenantId, query.accountId, q);

        return {
            pages,
            leads,
            meta: {q, truncated: pages.length >= MAX_SEARCH_RESULTS || leads.length >= MAX_SEARCH_RESULTS},
        };
    }

    private async searchLeads(tenantId: string, accountId: string, q: string): Promise<SearchLeadRow[]> {
        await requireAccountScope(tenantId, accountId);

        const {leads} = await this.leadRepo.getLeadList(accountId, {
            search: q,
            page: 1,
            pageSize: MAX_SEARCH_RESULTS,
            sortBy: "createdAt",
            sortDir: "desc",
        });
        const topics = await this.conversationRepo.getLatestTopics(leads.map((lead) => lead.id));

        return leads.map((lead) => ({
            id: lead.id,
            alias: lead.name,
            topic: topics.get(lead.id) ?? null,
            phoneMasked: lead.phoneMasked,
        }));
    }
}
