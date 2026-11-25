/**
 * The API answers every success as `{data, meta}` and every failure as `{error: {code, message,
 * details}}`. Tests read through these two helpers instead of re-declaring the envelope per assertion.
 */
export interface Enveloped<T> {
    data: T;
    meta: {requestId: string; cached?: boolean};
}

export interface ErrorEnvelope {
    error: {
        code: string;
        message: string;
        details: {path: string; message: string}[] | null;
    };
}

export async function readData<T>(response: Response): Promise<T> {
    const body = await response.json() as Enveloped<T>;

    return body.data;
}

export async function readEnvelope<T>(response: Response): Promise<Enveloped<T>> {
    return await response.json() as Enveloped<T>;
}

export async function readError(response: Response): Promise<ErrorEnvelope["error"]> {
    const body = await response.json() as ErrorEnvelope;

    return body.error;
}
