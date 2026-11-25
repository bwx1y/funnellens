import {DatabaseRepository} from "./base.repository";
import {ExportAuditEntity} from "@db/schema/ads/export-audit.entity";
import {UserEntity} from "@db/schema/core/user.entity";
import {and, desc, eq, sql} from "drizzle-orm";

export type ExportAudit = typeof ExportAuditEntity.$inferSelect;

export interface ExportAuditRow {
    id: number;
    report: string;
    filter: Record<string, unknown>;
    rowCount: number;
    userName: string | null;
    createdAt: string;
}

const RECENT_LIMIT = 50;

export class ExportAuditRepository extends DatabaseRepository {
    async record(input: {
        tenantId: string;
        userId: string;
        report: string;
        filter: Record<string, unknown>;
        rowCount: number;
    }): Promise<void> {
        await this.database.insert(ExportAuditEntity).values({
            tenantId: input.tenantId,
            userId: input.userId,
            report: input.report,
            filter: input.filter,
            rowCount: input.rowCount,
        });
    }

    /** The tenant's 50 newest exports, newest first; the user name comes from the join. */
    async findRecent(tenantId: string, accountId?: string): Promise<ExportAuditRow[]> {
        const conditions = [eq(ExportAuditEntity.tenantId, tenantId)];
        if (accountId !== undefined) {
            conditions.push(sql`${ExportAuditEntity.filter}->>'accountId' = ${accountId}`);
        }

        const rows = await this.database.select({
            id: ExportAuditEntity.id,
            report: ExportAuditEntity.report,
            filter: ExportAuditEntity.filter,
            rowCount: ExportAuditEntity.rowCount,
            createdAt: ExportAuditEntity.createdAt,
            userName: UserEntity.fullName,
        })
            .from(ExportAuditEntity)
            .leftJoin(UserEntity, eq(UserEntity.id, ExportAuditEntity.userId))
            .where(and(...conditions))
            .orderBy(desc(ExportAuditEntity.createdAt), desc(ExportAuditEntity.id))
            .limit(RECENT_LIMIT);

        return rows.map((row) => ({
            id: row.id,
            report: row.report,
            filter: (row.filter ?? {}) as Record<string, unknown>,
            rowCount: row.rowCount,
            userName: row.userName ?? null,
            createdAt: row.createdAt.toISOString(),
        }));
    }
}
