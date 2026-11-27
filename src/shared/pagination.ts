import {BadRequestError} from "./errors";

/** The only page sizes the API accepts; anything else is a client error, never a silent clamp. */
export const PAGE_SIZES = [5, 10, 15, 20, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 10;

export interface PageMeta {
    page: number;
    page_size: number;
    total: number;
    pages: number;
}

/** `pages` is always at least 1 so an empty result still has a valid page to clamp to. */
export function pagesOf(total: number, pageSize: number): number {
    return Math.max(1, Math.ceil(total / pageSize));
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
    return {page, page_size: pageSize, total, pages: pagesOf(total, pageSize)};
}

/** Parses and validates `page_size` (or its legacy aliases); `undefined` means the default. */
export function resolvePageSize(value: unknown, defaultPageSize: number = DEFAULT_PAGE_SIZE): number {
    if (value === undefined || value === null || value === "") return defaultPageSize;

    const size = Number(value);
    if (!PAGE_SIZES.includes(size as typeof PAGE_SIZES[number])) {
        throw new BadRequestError("page_size tidak valid", "INVALID_PAGE_SIZE");
    }

    return size;
}

/**
 * Resolves the requested page against a known total: an out-of-range page returns the last page, and
 * an invalid page number falls back to the first one.
 */
export function resolvePage(
    page: unknown,
    pageSize: unknown,
    total: number,
    defaultPageSize: number = DEFAULT_PAGE_SIZE
): {page: number; pageSize: number; pages: number} {
    const size = resolvePageSize(pageSize, defaultPageSize);
    const pages = pagesOf(total, size);
    const requested = Number(page ?? 1);
    const resolved = Number.isFinite(requested) ? Math.trunc(requested) : 1;

    return {page: Math.min(Math.max(resolved, 1), pages), pageSize: size, pages};
}
