import { db } from "../index";

export abstract class DatabaseRepository {
    protected readonly database = db;
}
