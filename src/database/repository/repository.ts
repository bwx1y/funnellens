import {drizzle} from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {Config} from "@/config";

const queryClient = postgres({
    host: Config.database.host,
    port: Config.database.port,
    user: Config.database.user,
    password: Config.database.password,
    database: Config.database.name,
    max: 1
})


export abstract class DatabaseRepository {
    protected readonly database = drizzle({
        client: queryClient
    })
}