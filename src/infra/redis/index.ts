import Redis from "ioredis";
import {Config} from "@/config";

export const redisConnection = new Redis({
    host: Config.redis.host,
    port: Config.redis.port,
    db: Config.redis.db,
    password: Config.redis.password,
    maxRetriesPerRequest: null,
})