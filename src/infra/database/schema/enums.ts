import {pgEnum} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("role", ["ADMIN", "VIEWER"]);

export const userTokenTypeEnum = pgEnum("token_type", [
    "EMAIL_VERIFICATION",
    "PASSWORD_RESET",
]);

export const waSessionStatusEnum = pgEnum("session-status", [
    "created",
    "initializing",
    "qr_ready",
    "authenticating",
    "ready",
    "disconnected",
    "action_required",
    "failed",
]);

export const leadTemperatureEnum = pgEnum("lead_temperature", [
    "COLD",
    "WARM",
    "HOT",
]);

export const leadStageEnum = pgEnum("lead_stage", [
    "CHAT_STARTED",
    "REPLIED",
    "QUALIFIED",
    "CLOSING",
    "CLOSED",
]);

export const waChannelEnum = pgEnum("wa_channel", ["OPENWA", "CLOUD"]);

export const explanationStateEnum = pgEnum("explanation_state", [
    "PENDING",
    "READY",
    "FALLBACK",
    "UNAVAILABLE",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
    "INBOUND",
    "OUTBOUND",
]);

export const insightLevelEnum = pgEnum("insight_level", [
    "account",
    "campaign",
    "adset",
    "ad",
]);

export const alertLevelEnum = pgEnum("alert_level", [
    "INFO",
    "WARNING",
    "CRITICAL",
]);

export const alertStatusEnum = pgEnum("alert_status", [
    "ACTIVE",
    "DONE",
    "SNOOZED",
]);

export const syncRunStatusEnum = pgEnum("sync_run_status", [
    "RUNNING",
    "SUCCESS",
    "FAILED",
]);
