import { db } from "../index";
import type {PgTransaction} from "drizzle-orm/pg-core";

export type DatabaseTransaction = PgTransaction<any, any, any>;

export abstract class DatabaseRepository {
    protected readonly database = db;

    /** UTC `YYYY-MM-DD` string for Drizzle `date()` columns. */
    protected toDateString(value: Date): string {
        return value.toISOString().slice(0, 10);
    }
}
