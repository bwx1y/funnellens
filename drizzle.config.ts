import { defineConfig } from 'drizzle-kit';
import {Config} from "@/config";

export default defineConfig({
    schema: "./src/database/entity/*.entity.ts",
    out: './src/database/migration',
    dialect: "postgresql",
    dbCredentials: {
        host: Config.database.host,
        port: Config.database.port,
        user: Config.database.user,
        password: Config.database.password,
        database: Config.database.name,
        ssl: false
    },
    verbose: true,
    strict: true
})