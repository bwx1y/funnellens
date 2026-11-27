/**
 * Meta Cloud API webhook payload. Every field is optional: a delivery may carry a partial `value`,
 * so callers narrow with `?.` and default to `[]` instead of trusting a schema.
 */

export interface CloudReferral {
    source_type?: string;
    source_id?: string;
    source_url?: string;
    ctwa_clid?: string;
}

export interface CloudMessage {
    id?: string;
    from?: string;
    to?: string;
    timestamp?: string;
    type?: string;
    text?: {body?: string};
    button?: {text?: string};
    context?: {id?: string};
    referral?: CloudReferral;
}

export interface CloudChangeValue {
    metadata?: {phone_number_id?: string; display_phone_number?: string};
    contacts?: {profile?: {name?: string}; wa_id?: string}[];
    messages?: CloudMessage[];
    /** Not part of Meta's public Cloud API: treated as the CS-side echo of an outgoing message. */
    message_echoes?: CloudMessage[];
}

export interface CloudWebhookPayload {
    object?: string;
    entry?: {id?: string; changes?: {value?: CloudChangeValue}[]}[];
}
