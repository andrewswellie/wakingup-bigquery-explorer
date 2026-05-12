export const COMMON_AMPLITUDE_FIELDS = [
  "user_id",
  "event_time",
  "event_type",
  "device_id",
  "session_id",
  "insert_id",
  "uuid",
  "event_properties",
  "user_properties"
] as const;

export const LIMIT_OPTIONS = [100, 500, 1000, 10000, 50000] as const;

export type FieldSchema = {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: FieldSchema[];
};

export type VirtualField = {
  source: "event_properties" | "user_properties";
  key: string;
  sourceType?: string;
};

export type SelectedField =
  | { kind: "column"; name: string; type?: string }
  | { kind: "virtual"; source: "event_properties" | "user_properties"; key: string; sourceType?: string };

export type FilterOperator =
  | "equals"
  | "contains"
  | "starts_with"
  | "greater_than"
  | "less_than"
  | "between"
  | "is_not_null";

export type QueryFilter = {
  id: string;
  field: SelectedField;
  operator: FilterOperator;
  value?: string;
  valueTo?: string;
};

export type QueryRequest = {
  projectId: string;
  dataset: string;
  table: string;
  fields: SelectedField[];
  filters: QueryFilter[];
  limit: number;
  orderByEventTime?: boolean;
  estimateOnly?: boolean;
};

export type JsonSource = "event_properties" | "user_properties";

export type JsonProfileKey = {
  path: string;
  count: number;
  samples: string[];
};

export type JsonProfileRequest = {
  projectId: string;
  dataset: string;
  table: string;
  source: JsonSource;
  sourceType?: string;
  rowLimit?: number;
  startDate?: string;
  endDate?: string;
  eventTimeType?: string;
  orderByEventTime?: boolean;
};

export type JsonProfileResponse = {
  keys: JsonProfileKey[];
  scannedRows: number;
  sql: string;
};

export type QueryResponse = {
  sql: string;
  params: Record<string, string | number | boolean | null>;
  estimatedBytes?: string;
  estimatedBytesNumber?: number;
  estimatedCost?: string;
  estimatedCostUsd?: number;
  costEstimateNote?: string;
  warning?: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  columns?: string[];
};


export type EventTypeSummary = {
  eventType: string;
  count: number;
};

export type EventTypesRequest = {
  projectId: string;
  dataset: string;
  table: string;
  startDate?: string;
  endDate?: string;
  eventTimeType?: string;
  limit?: number;
};

export type EventTypesResponse = {
  eventTypes: EventTypeSummary[];
  sql: string;
};
