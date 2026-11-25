const BOM = "\uFEFF";
const EOL = "\r\n";

/**
 * Machine-readable CSV: a BOM so Excel detects UTF-8, CRLF line ends, and every cell quoted.
 * A `null` cell is empty — writing `"null"` would turn a missing measurement into a word.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
    const cell = (value: string | number | null | undefined): string => {
        if (value === null || value === undefined) return '""';

        return `"${String(value).replace(/"/g, '""')}"`;
    };

    const lines = [headers, ...rows].map((row) => row.map(cell).join(","));

    return `${BOM}${lines.join(EOL)}${EOL}`;
}

/** Download response for a CSV body built by {@link toCsv}. */
export function csvResponse(filename: string, body: string): Response {
    return new Response(body, {
        headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
        },
    });
}

/**
 * Fixed-point number with a dot, never the id-ID comma: the file is read by machines. `null` stays
 * empty so a missing ratio is not mistaken for zero.
 */
export function csvDecimal(value: number | null, digits: number): string | null {
    return value === null ? null : value.toFixed(digits);
}
