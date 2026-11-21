import {DatabaseRepository} from "@/database/repository/repository";
import {WaPhoneEntity} from "@/database/entity/wa-phone.entity";
import {WaMessageEntity} from "@/database/entity/wa-message.entity";
import {WaSessionEntity} from "@/database/entity/wa-session.entity";
import {and, eq, sql} from "drizzle-orm";

type StatusType = typeof WaPhoneEntity.$inferSelect.status;

type ContentItem = {
    content: string | null;
    score: number | null;
    status: typeof WaMessageEntity.$inferSelect.status;
};

export class WaPhoneRepository extends DatabaseRepository {
    async upsert(data: {
        sessionId: string;
        phone: string;
        phoneName?: string | null;
        status?: StatusType;
    }) {
        const [result] = await this.database
            .insert(WaPhoneEntity)
            .values({
                sessionId: data.sessionId,
                phone: data.phone,
                phoneName: data.phoneName,
                status: data.status,
            })
            .onConflictDoUpdate({
                target: WaPhoneEntity.phone,
                set: {
                    sessionId: data.sessionId,
                    phoneName: data.phoneName ? data.phoneName : sql`${WaPhoneEntity.phoneName}`,
                    status: data.status ? data.status : sql`${WaPhoneEntity.status}`,
                },
            })
            .returning();

        return result;
    }

    async findByPhone(phone: string) {
        const [result] = await this.database
            .select()
            .from(WaPhoneEntity)
            .where(eq(WaPhoneEntity.phone, phone))
            .limit(1);

        return result;
    }

    async findAllByTenantId(tenantId: string, sessionId?: string) {
        return this.database
            .select({
                phone: {
                    number: WaPhoneEntity.phone,
                    name: WaPhoneEntity.phoneName,
                },
                status: WaPhoneEntity.status,
                content: sql<ContentItem[]>`COALESCE(
                    (
                        SELECT array_to_json(array_agg(sub))
                        FROM (
                            SELECT
                                ${WaMessageEntity.content} AS content,
                                ${WaMessageEntity.score} AS score,
                                ${WaMessageEntity.status} AS status
                            FROM ${WaMessageEntity}
                            WHERE ${WaMessageEntity.phoneId} = ${WaPhoneEntity.id}
                            ORDER BY ${WaMessageEntity}.id DESC
                            LIMIT 10
                        ) sub
                    ),
                    '[]'::json
                )`,
            })
            .from(WaPhoneEntity)
            .innerJoin(
                WaSessionEntity,
                eq(WaPhoneEntity.sessionId, WaSessionEntity.id)
            )
            .where(
                and(
                    eq(WaSessionEntity.tenantId, tenantId),
                    sessionId ? eq(WaPhoneEntity.sessionId, sessionId) : undefined
                )
            );
    }

    async getAudienceLevelStats(tenantId: string) {
        const [stats] = await this.database
            .select({
                total: sql<number>`COUNT(*)::int`,
                cold: sql<number>`COUNT(*) FILTER (WHERE ${WaPhoneEntity.status} = 'COLD')::int`,
                warm: sql<number>`COUNT(*) FILTER (WHERE ${WaPhoneEntity.status} = 'WARM')::int`,
                hot: sql<number>`COUNT(*) FILTER (WHERE ${WaPhoneEntity.status} = 'HOT')::int`,
            })
            .from(WaPhoneEntity)
            .innerJoin(
                WaSessionEntity,
                eq(WaPhoneEntity.sessionId, WaSessionEntity.id)
            )
            .where(eq(WaSessionEntity.tenantId, tenantId));

        const total = stats?.total ?? 0;
        const toPercent = (count: number) =>
            total === 0 ? 0 : Math.round((count / total) * 100);

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
