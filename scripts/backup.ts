import {mkdir, readdir, stat, unlink} from "node:fs/promises";
import {join, resolve} from "node:path";
import {Config} from "@/config";

/** How many daily dumps to keep; older ones are deleted on the same run that writes a new one. */
const KEEP_DAYS = 14;
const BACKUP_DIR = resolve(process.cwd(), "backup");

function stamp(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");

    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Custom-format dump (`--no-owner` so it restores into any role). The file is verified non-empty
 * before the process reports success: a truncated dump that exits 0 is worse than no dump at all.
 */
async function dump(target: string): Promise<void> {
    const child = Bun.spawn([
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--host", Config.database.host,
        "--port", String(Config.database.port),
        "--username", Config.database.user,
        "--dbname", Config.database.name,
        "--file", target,
    ], {
        env: {...process.env, PGPASSWORD: Config.database.password},
        stdout: "inherit",
        stderr: "inherit",
    });

    const code = await child.exited;
    if (code !== 0) throw new Error(`pg_dump keluar dengan kode ${code}`);
}

async function prune(): Promise<string[]> {
    const files = (await readdir(BACKUP_DIR))
        .filter((name) => name.startsWith("funnellens-") && name.endsWith(".dump"))
        .sort();

    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const removed: string[] = [];

    for (const name of files) {
        const path = join(BACKUP_DIR, name);
        const info = await stat(path);
        if (info.mtimeMs >= cutoff) continue;

        await unlink(path);
        removed.push(name);
    }

    return removed;
}

async function main(): Promise<void> {
    await mkdir(BACKUP_DIR, {recursive: true});

    const target = join(BACKUP_DIR, `funnellens-${stamp()}.dump`);
    await dump(target);

    const info = await stat(target);
    if (info.size === 0) {
        await unlink(target);
        throw new Error(`dump ${target} kosong; file dihapus`);
    }

    const removed = await prune();
    console.log(`[backup] ${target} (${info.size} bytes)`);
    if (removed.length > 0) console.log(`[backup] dihapus ${removed.length} dump lebih tua dari ${KEEP_DAYS} hari`);
}

if (import.meta.main) {
    await main();
}
