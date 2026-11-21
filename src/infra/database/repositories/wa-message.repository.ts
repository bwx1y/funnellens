import {DatabaseRepository} from "./base.repository";
import {WaMessageEntity} from "@db/schema/wa/wa-message.entity";

export class WaMessageRepository extends DatabaseRepository {
    async create(body: typeof WaMessageEntity.$inferInsert) {
        return this.database.insert(WaMessageEntity)
            .values(body)
            .returning();
    }
}
