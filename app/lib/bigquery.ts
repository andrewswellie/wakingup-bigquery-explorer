import { BigQuery } from "@google-cloud/bigquery";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
import { COMMON_AMPLITUDE_FIELDS, JsonProfileKey, JsonProfileRequest, LIMIT_OPTIONS, QueryRequest, SelectedField } from "./types";

const MAX_LARGE_SCAN_BYTES = 10 * 1024 * 1024 * 1024;
const GCLOUD_CLIENT_CACHE_MS = 45 * 60 * 1000;
const GCLOUD_TOKEN_EXPIRY_MS = 55 * 60 * 1000;
const execFileAsync = promisify(execFile);

type CachedGcloudClient = {
  client: BigQuery;
  expiresAt: number;
};

const gcloudClients = new Map<string, CachedGcloudClient>();

async function getBigQueryClient(projectId: string) {
  const trimmedProjectId = escapeIdentifier(projectId);
  const cached = gcloudClients.get(trimmedProjectId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const accessToken = await getGcloudAccessToken();
  const authClient = new OAuth2Client();
  authClient.setCredentials({
    access_token: accessToken,
    expiry_date: Date.now() + GCLOUD_TOKEN_EXPIRY_MS
  });

  const client = new BigQuery({
    projectId: trimmedProjectId,
    authClient
  } as unknown as ConstructorParameters<typeof BigQuery>[0]);

  gcloudClients.set(trimmedProjectId, {
    client,
    expiresAt: Date.now() + GCLOUD_CLIENT_CACHE_MS
  });

  return client;
}

async function getGcloudAccessToken() {
  try {
    const { stdout } = await execFileAsync("gcloud", ["auth", "print-access-token"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });
    const token = stdout.trim();

    if (!token) {
      throw new Error("gcloud did not return an access token.");
    }

    return token;
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Unable to read credentials from the Google Cloud CLI. Run \`gcloud auth login\` in this environment and ensure gcloud is on PATH.${detail}`);
  }
}

export function quoteTablePath(projectId: string, dataset: string, table: string) {
  return `\`${escapeIdentifier(projectId)}.${escapeIdentifier(dataset)}.${escapeIdentifier(table)}\``;
}

export function quoteFieldPath(fieldName: string) {
  return fieldName
    .split(".")
    .map((part) => `\`${escapeIdentifier(part)}\``)
    .join(".");
}

export function escapeIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error("Identifier cannot be empty.");
  }
  if (trimmed.includes("`")) {
    throw new Error("Identifiers cannot contain backticks.");
  }
  return trimmed;
}

export function cleanJsonKey(key: string) {
  const trimmed = key.trim().replace(/^\.+|\.+$/g, "");
  if (!trimmed) {
    throw new Error("JSON key cannot be empty.");
  }
  if (trimmed.includes("'")) {
    throw new Error("JSON keys cannot contain single quotes.");
  }
  return trimmed;
}

export function aliasForField(field: SelectedField) {
  if (field.kind === "column") {
    return field.name.replace(/[^A-Za-z0-9_]/g, "_");
  }

  return `${field.source}_${cleanJsonKey(field.key).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

export function expressionForField(field: SelectedField) {
  if (field.kind === "column") {
    return quoteFieldPath(field.name);
  }

  const key = cleanJsonKey(field.key);
  const jsonPath = `$.${key.split(".").map(escapeJsonPathPart).join(".")}`;
  const source = quoteFieldPath(field.source);
  const sourceType = field.sourceType?.toUpperCase();

  if (sourceType === "STRING") {
    return `JSON_VALUE(SAFE.PARSE_JSON(${source}), '${jsonPath}')`;
  }

  return `JSON_VALUE(${source}, '${jsonPath}')`;
}

function escapeJsonPathPart(part: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
    return part;
  }

  return `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildQuery(request: QueryRequest) {
  const limit = Number(request.limit);
  if (!LIMIT_OPTIONS.includes(limit as (typeof LIMIT_OPTIONS)[number])) {
    throw new Error("Choose one of the supported LIMIT values: 100, 500, 1,000, 10,000, or 50,000.");
  }

  if (!request.fields.length) {
    throw new Error("Select at least one field before running a query.");
  }

  const selected = request.fields.map((field) => {
    const alias = aliasForField(field);
    return `${expressionForField(field)} AS \`${escapeIdentifier(alias)}\``;
  });

  const params: Record<string, string> = {};
  const whereClauses = request.filters
    .filter((filter) => filter.field && filter.operator)
    .map((filter, index) => {
      const expression = expressionForField(filter.field);
      const paramName = `filter_${index}`;
      const paramToName = `filter_${index}_to`;

      switch (filter.operator) {
        case "equals":
          params[paramName] = normalizeFilterValue(filter.field, requiredValue(filter.value, "equals"));
          return `${expression} = ${parameterReference(filter.field, paramName)}`;
        case "contains":
          params[paramName] = `%${requiredValue(filter.value, "contains")}%`;
          return `CAST(${expression} AS STRING) LIKE @${paramName}`;
        case "starts_with":
          params[paramName] = `${requiredValue(filter.value, "starts with")}%`;
          return `CAST(${expression} AS STRING) LIKE @${paramName}`;
        case "greater_than":
          params[paramName] = normalizeFilterValue(filter.field, requiredValue(filter.value, "greater than"));
          return `${expression} > ${parameterReference(filter.field, paramName)}`;
        case "less_than":
          params[paramName] = normalizeFilterValue(filter.field, requiredValue(filter.value, "less than"));
          return `${expression} < ${parameterReference(filter.field, paramName)}`;
        case "between":
          params[paramName] = normalizeFilterValue(filter.field, requiredValue(filter.value, "between start"));
          params[paramToName] = normalizeFilterValue(filter.field, requiredValue(filter.valueTo, "between end"));
          return `${expression} BETWEEN ${parameterReference(filter.field, paramName)} AND ${parameterReference(filter.field, paramToName)}`;
        case "is_not_null":
          return `${expression} IS NOT NULL`;
        default:
          throw new Error("Unsupported filter operator.");
      }
    });

  const sql = [
    `SELECT\n  ${selected.join(",\n  ")}`,
    `FROM ${quoteTablePath(request.projectId, request.dataset, request.table)}`,
    whereClauses.length ? `WHERE ${whereClauses.join("\n  AND ")}` : "",
    request.orderByEventTime ? `ORDER BY ${quoteFieldPath("event_time")} DESC` : "",
    `LIMIT ${limit}`
  ]
    .filter(Boolean)
    .join("\n");

  return { sql, params, columns: request.fields.map(aliasForField) };
}

function normalizeFilterValue(field: SelectedField, value: string) {
  if (field.kind === "virtual") return value;

  switch (field.type?.toUpperCase()) {
    case "TIMESTAMP":
    case "DATETIME":
      return normalizeDateTimeValue(value);
    case "DATE":
      return normalizeDateValue(value);
    default:
      return value;
  }
}

function normalizeDateTimeValue(value: string) {
  const normalized = value.trim().replace("T", " ");

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  return normalized;
}

function normalizeDateValue(value: string) {
  return value.trim().slice(0, 10);
}

function parameterReference(field: SelectedField, paramName: string) {
  if (field.kind === "virtual") {
    return `@${paramName}`;
  }

  switch (field.type?.toUpperCase()) {
    case "TIMESTAMP":
      return `TIMESTAMP(@${paramName})`;
    case "DATETIME":
      return `DATETIME(@${paramName})`;
    case "DATE":
      return `DATE(@${paramName})`;
    case "TIME":
      return `TIME(@${paramName})`;
    case "INTEGER":
    case "INT64":
      return `CAST(@${paramName} AS INT64)`;
    case "FLOAT":
    case "FLOAT64":
      return `CAST(@${paramName} AS FLOAT64)`;
    case "NUMERIC":
    case "BIGNUMERIC":
      return `CAST(@${paramName} AS ${field.type.toUpperCase()})`;
    case "BOOLEAN":
    case "BOOL":
      return `CAST(@${paramName} AS BOOL)`;
    default:
      return `@${paramName}`;
  }
}

function requiredValue(value: string | undefined, label: string) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`A value is required for the ${label} filter.`);
  }

  return value;
}


export function buildJsonProfileQuery(request: JsonProfileRequest) {
  const source = request.source === "user_properties" ? "user_properties" : "event_properties";
  const rowLimit = Math.min(Math.max(Number(request.rowLimit) || 500, 1), 2000);
  const params: Record<string, string> = {};
  const whereClauses = [`${quoteFieldPath(source)} IS NOT NULL`];

  if (request.startDate) {
    params.start_date = startOfDateValue(request.startDate, request.eventTimeType);
    whereClauses.push(`${quoteFieldPath("event_time")} >= ${temporalParameterReference(request.eventTimeType, "start_date")}`);
  }

  if (request.endDate) {
    params.end_date = endOfDateValue(request.endDate, request.eventTimeType);
    whereClauses.push(`${quoteFieldPath("event_time")} <= ${temporalParameterReference(request.eventTimeType, "end_date")}`);
  }

  const sql = [
    `SELECT ${quoteFieldPath(source)} AS json_blob`,
    `FROM ${quoteTablePath(request.projectId, request.dataset, request.table)}`,
    `WHERE ${whereClauses.join("\n  AND ")}`,
    request.orderByEventTime ? `ORDER BY ${quoteFieldPath("event_time")} DESC` : "",
    `LIMIT ${rowLimit}`
  ]
    .filter(Boolean)
    .join("\n");

  return { sql, params };
}

function startOfDateValue(date: string, fieldType?: string) {
  if (fieldType?.toUpperCase() === "DATE") return normalizeDateValue(date);
  return `${normalizeDateValue(date)} 00:00:00`;
}

function endOfDateValue(date: string, fieldType?: string) {
  if (fieldType?.toUpperCase() === "DATE") return normalizeDateValue(date);
  return `${normalizeDateValue(date)} 23:59:59.999999`;
}

function temporalParameterReference(fieldType: string | undefined, paramName: string) {
  switch (fieldType?.toUpperCase()) {
    case "DATETIME":
      return `DATETIME(@${paramName})`;
    case "DATE":
      return `DATE(@${paramName})`;
    case "TIMESTAMP":
    default:
      return `TIMESTAMP(@${paramName})`;
  }
}

export async function profileJsonFields(request: JsonProfileRequest) {
  const { sql, params } = buildJsonProfileQuery(request);
  const rows = await runQuery(request.projectId, sql, params);
  const keyMap = new Map<string, { count: number; samples: Set<string> }>();

  for (const row of rows) {
    const parsed = parseJsonBlob(row.json_blob);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }

    collectJsonPaths(parsed as Record<string, unknown>, "", keyMap);
  }

  const keys: JsonProfileKey[] = [...keyMap.entries()]
    .map(([path, value]) => ({ path, count: value.count, samples: [...value.samples] }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 250);

  return { keys, scannedRows: rows.length, sql };
}

function parseJsonBlob(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return value;
}

function collectJsonPaths(value: Record<string, unknown>, prefix: string, keyMap: Map<string, { count: number; samples: Set<string> }>) {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const entry = keyMap.get(path) ?? { count: 0, samples: new Set<string>() };
    entry.count += 1;

    if (nested !== null && nested !== undefined && entry.samples.size < 4) {
      entry.samples.add(sampleJsonValue(nested));
    }

    keyMap.set(path, entry);

    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      collectJsonPaths(nested as Record<string, unknown>, path, keyMap);
    }
  }
}

function sampleJsonValue(value: unknown) {
  const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
  return serialized.length > 80 ? `${serialized.slice(0, 77)}…` : serialized;
}

export async function getSchema(projectId: string, dataset: string, table: string) {
  const client = await getBigQueryClient(projectId);
  const [metadata] = await client.dataset(dataset).table(table).getMetadata();
  const fields = (metadata.schema?.fields ?? []) as Array<{
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: unknown[];
  }>;

  return fields;
}

export async function estimateQuery(projectId: string, sql: string, params: Record<string, string>) {
  const client = await getBigQueryClient(projectId);
  const [job] = await client.createQueryJob({ query: sql, params, dryRun: true, useLegacySql: false });
  const totalBytesProcessed = Number(job.metadata.statistics?.totalBytesProcessed ?? 0);

  return {
    totalBytesProcessed,
    formatted: formatBytes(totalBytesProcessed),
    warning:
      totalBytesProcessed > MAX_LARGE_SCAN_BYTES
        ? `This query may scan ${formatBytes(totalBytesProcessed)}. Consider adding filters or lowering the limit.`
        : undefined
  };
}

export async function runQuery(projectId: string, sql: string, params: Record<string, string>) {
  const client = await getBigQueryClient(projectId);
  const [rows] = await client.query({ query: sql, params, useLegacySql: false });
  return rows.map(serializeRow) as Record<string, unknown>[];
}

export function serializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializeValue(value)]));
}

export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value === "object") {
    const maybeValue = value as { value?: unknown };
    if ("value" in maybeValue && Object.keys(value as Record<string, unknown>).length <= 2) {
      return serializeValue(maybeValue.value);
    }

    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializeValue(nested)]));
  }

  return value;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function hasEventTime(fields: Array<{ name: string }>) {
  return fields.some((field) => field.name === "event_time");
}

export function sortSchema(fields: Array<{ name: string }>) {
  return [...fields].sort((a, b) => {
    const aCommon = COMMON_AMPLITUDE_FIELDS.includes(a.name as (typeof COMMON_AMPLITUDE_FIELDS)[number]);
    const bCommon = COMMON_AMPLITUDE_FIELDS.includes(b.name as (typeof COMMON_AMPLITUDE_FIELDS)[number]);
    if (aCommon && !bCommon) return -1;
    if (!aCommon && bCommon) return 1;
    return a.name.localeCompare(b.name);
  });
}
