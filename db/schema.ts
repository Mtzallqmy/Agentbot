import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  role: text("role").notNull().default("superadmin"),
  ...timestamps,
});

export const aiProviders = sqliteTable("ai_providers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  compatibility: text("compatibility").notNull().default("openai"),
  encryptedKey: text("encrypted_key").notNull(),
  keyHint: text("key_hint").notNull(),
  defaultModel: text("default_model"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("ai_providers_owner_name_idx").on(table.ownerId, table.name),
]);

export const aiModels = sqliteTable("ai_models", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull().references(() => aiProviders.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  ...timestamps,
}, (table) => [
  uniqueIndex("ai_models_provider_model_idx").on(table.providerId, table.modelId),
]);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  providerId: text("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
  modelId: text("model_id"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  providerRequestId: text("provider_request_id"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull().default("completed"),
  ...timestamps,
});

export const agentProjects = sqliteTable("agent_projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => agentProjects.id, { onDelete: "cascade" }),
  instruction: text("instruction").notNull(),
  status: text("status").notNull().default("waiting_for_worker"),
  progress: integer("progress").notNull().default(0),
  ...timestamps,
});

export const backgroundJobs = sqliteTable("background_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  errorCode: text("error_code"),
  idempotencyKey: text("idempotency_key"),
  ...timestamps,
}, (table) => [
  uniqueIndex("background_jobs_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
]);

export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  ipHash: text("ip_hash"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});
