import {DatabaseRepository} from "@/database/repository/repository";
import {WaMessageEntity} from "@/database/entity/wa-message.entity";
import {and, eq, sql} from "drizzle-orm";
import {WaSessionEntity} from "@/database/entity/wa-session.entity";

type StatusType = typeof WaMessageEntity.$inferSelect.status;

type ContentItem = {
    content: string | null;
    score: number | null;
    status: StatusType;
}

export class WaMessageRepository extends DatabaseRepository {
    async findAllByTenantIdAndGrubByPhone(tenantId: string, sessionId?: string) {
        return this.database.select({
            phone: {
                number: WaMessageEntity.phone,
                name: sql<string | null>`MAX(
                ${WaMessageEntity.phoneName}
                )`
            },
            status: sql<StatusType>`mode
            () WITHIN GROUP (ORDER BY
            ${WaMessageEntity.status}
            )`,
            content: sql<ContentItem[]>`array_to_json(
              (array_agg(
                json_build_object(
                  'content', ${WaMessageEntity.content},
                  'score', ${WaMessageEntity.score},
                  'status', ${WaMessageEntity.status}
                )
                ORDER BY ${WaMessageEntity}.ctid DESC
              ))[1:10]
            )`
        }).from(WaMessageEntity)
            .innerJoin(
                WaSessionEntity,
                eq(WaMessageEntity.sessionId, WaSessionEntity.id)
            )
            .where(
                and(
                    eq(WaSessionEntity.tenantId, tenantId),
                    sessionId ? eq(WaMessageEntity.sessionId, sessionId) : undefined
                )
            ).groupBy(WaMessageEntity.phone)
    }

    async create(body: typeof WaMessageEntity.$inferInsert) {
        return this.database.insert(WaMessageEntity)
            .values(body);
    }

    async getAudienceLevelStats(tenantId: string) {
        const phoneAudience = this.database.$with("phone_audience").as(
            this.database.select({
                phone: WaMessageEntity.phone,
                dominantStatus: sql<string>`mode
                () WITHIN GROUP (ORDER BY
                ${WaMessageEntity.status}
                )`.as(
                    "dominant_status"
                ),
            })
                .from(WaMessageEntity)
                .innerJoin(
                    WaSessionEntity,
                    eq(WaMessageEntity.sessionId, WaSessionEntity.id)
                )
                .where(eq(WaSessionEntity.tenantId, tenantId))
                .groupBy(WaMessageEntity.phone)
        );

        const [stats] = await this.database
            .with(phoneAudience)
            .select({
                total: sql<number>`COUNT(*)::int`,
                cold: sql<number>`COUNT(*) FILTER (WHERE ${phoneAudience.dominantStatus} = 'COLD')::int`,
                warm: sql<number>`COUNT(*) FILTER (WHERE ${phoneAudience.dominantStatus} = 'WARM')::int`,
                hot: sql<number>`COUNT(*) FILTER (WHERE ${phoneAudience.dominantStatus} = 'HOT')::int`,
            })
            .from(phoneAudience);

        const total = stats?.total ?? 0;
        const toPercent = (count: number) =>
            total === 0 ? 0 : Math.round((count / total) * 100)

        return [
            {
                level: "Cold",
                count: stats?.cold ?? 0,
                percentage: toPercent(stats?.cold ?? 0),
            },
            {
                level: "Warm",
                count: stats?.warm ?? 0,
                percentage: toPercent(stats?.warm ?? 0),
            },
            {
                level: "Hot",
                count: stats?.hot ?? 0,
                percentage: toPercent(stats?.hot ?? 0),
            },
        ];
    }
}