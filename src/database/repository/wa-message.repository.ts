import {DatabaseRepository} from "@/database/repository/repository";
import {WaMessageEntity} from "@/database/entity/wa-message.entity";

export class WaMessageRepository extends DatabaseRepository {
    async create(body: typeof WaMessageEntity.$inferInsert) {
        return this.database.insert(WaMessageEntity)
            .values(body)
            .returning();
    }
}
