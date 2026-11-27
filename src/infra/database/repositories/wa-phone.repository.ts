import {DatabaseRepository} from "./base.repository";
import {WaPhoneEntity} from "@db/schema/wa/wa-phone.entity";
import {eq, sql} from "drizzle-orm";

export class WaPhoneRepository extends DatabaseRepository {
    async upsert(data: {
        sessionId: string;
        phone: string;
        phoneName?: string | null;
    }) {
        const [result] = await this.database
            .insert(WaPhoneEntity)
            .values({
                tenantId: sql`(select tenant_id from wa_session where id = ${data.sessionId})`,
                sessionId: data.sessionId,
                phone: data.phone,
                phoneName: data.phoneName,
            })
            .onConflictDoUpdate({
                target: WaPhoneEntity.phone,
                set: {
                    sessionId: data.sessionId,
                    phoneName: data.phoneName ? data.phoneName : sql`${WaPhoneEntity.phoneName}`,
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

    /** Binds a Cloud API webhook (`entry.metadata.phone_number_id`) to its tenant phone row. */
    async findByPhoneNumberId(phoneNumberId: string): Promise<(typeof WaPhoneEntity.$inferSelect) | null> {
        const [result] = await this.database
            .select()
            .from(WaPhoneEntity)
            .where(eq(WaPhoneEntity.phoneNumberId, phoneNumberId))
            .limit(1);

        return result ?? null;
    }

    /** One phone row per session; ordered by `phone` so a multi-row session is deterministic. */
    async findBySessionId(sessionId: string): Promise<(typeof WaPhoneEntity.$inferSelect) | null> {
        const [result] = await this.database
            .select()
            .from(WaPhoneEntity)
            .where(eq(WaPhoneEntity.sessionId, sessionId))
            .orderBy(WaPhoneEntity.phone)
            .limit(1);

        return result ?? null;
    }
}
