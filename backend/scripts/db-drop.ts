import postgres from "postgres";
import {Config} from "@/config";

const sql = postgres({
    host: Config.database.host,
    port: Config.database.port,
    user: Config.database.user,
    password: Config.database.password,
    database: Config.database.name,
    max: 1,
});

async function dropAll() {
    console.log(`[db:drop] Menghapus seluruh tabel dan tipe data di database "${Config.database.name}"...`);

    try {
        const username = Config.database.user.replace(/"/g, '""');
        await sql.unsafe(`
            DROP SCHEMA IF EXISTS public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO "${username}";
            GRANT ALL ON SCHEMA public TO public;
        `);

        console.log("[db:drop] ✓ Schema public berhasil di-reset bersih (seluruh tabel & enum terhapus).");
    } catch (error) {
        console.error("[db:drop] Gagal menghapus database:", error);
        process.exit(1);
    } finally {
        await sql.end();
    }
}

dropAll();
