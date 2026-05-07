"use client";

import { FormEvent, useMemo, useState } from "react";
import { COMMON_AMPLITUDE_FIELDS, FieldSchema, FilterOperator, LIMIT_OPTIONS, QueryFilter, QueryResponse, SelectedField } from "./lib/types";

const operatorLabels: Record<FilterOperator, string> = {
  equals: "Equals",
  contains: "Contains",
  starts_with: "Starts with",
  greater_than: "Greater than",
  less_than: "Less than",
  between: "Between",
  is_not_null: "Is not null"
};

const defaultConnection = {
  projectId: process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID ?? "",
  dataset: process.env.NEXT_PUBLIC_DEFAULT_DATASET ?? "",
  table: process.env.NEXT_PUBLIC_DEFAULT_TABLE ?? ""
};

export default function Home() {
  const [connection, setConnection] = useState(defaultConnection);
  const [schema, setSchema] = useState<FieldSchema[]>([]);
  const [hasEventTime, setHasEventTime] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedFields, setSelectedFields] = useState<SelectedField[]>([]);
  const [virtualSource, setVirtualSource] = useState<"event_properties" | "user_properties">("event_properties");
  const [virtualKey, setVirtualKey] = useState("");
  const [filters, setFilters] = useState<QueryFilter[]>([]);
  const [limit, setLimit] = useState(100);
  const [query, setQuery] = useState<QueryResponse | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState("");

  const fieldTypeMap = useMemo(() => new Map(schema.map((field) => [field.name, field.type])), [schema]);
  const selectedAliases = useMemo(() => selectedFields.map(aliasForSelected), [selectedFields]);
  const availableFilterFields = useMemo(() => {
    const eventTimeField: SelectedField | undefined = hasEventTime ? { kind: "column", name: "event_time", type: fieldTypeMap.get("event_time") } : undefined;
    return eventTimeField ? mergeSelected(selectedFields, [eventTimeField]) : selectedFields;
  }, [fieldTypeMap, hasEventTime, selectedFields]);
  const filteredSchema = useMemo(() => {
    const search = schemaSearch.toLowerCase().trim();
    if (!search) return schema;
    return schema.filter((field) => `${field.name} ${field.type} ${field.mode ?? ""} ${field.description ?? ""}`.toLowerCase().includes(search));
  }, [schema, schemaSearch]);

  async function loadSchema(event: FormEvent) {
    event.preventDefault();
    setSchemaLoading(true);
    setError("");
    setQuery(null);

    try {
      const response = await fetch("/api/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connection)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load schema.");
      setSchema(data.fields);
      setHasEventTime(Boolean(data.hasEventTime));
      setSelectedFields([]);
      setFilters([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load schema.");
    } finally {
      setSchemaLoading(false);
    }
  }

  function toggleField(field: FieldSchema) {
    setSelectedFields((current) => {
      const exists = current.some((selected) => selected.kind === "column" && selected.name === field.name);
      if (exists) {
        return current.filter((selected) => !(selected.kind === "column" && selected.name === field.name));
      }
      return [...current, { kind: "column", name: field.name, type: field.type }];
    });
  }

  function selectCommonFields() {
    const common = schema
      .filter((field) => COMMON_AMPLITUDE_FIELDS.includes(field.name as (typeof COMMON_AMPLITUDE_FIELDS)[number]))
      .map((field) => ({ kind: "column" as const, name: field.name, type: field.type }));
    setSelectedFields((current) => mergeSelected(current, common));
  }

  function addVirtualField() {
    const key = virtualKey.trim();
    if (!key) return;
    const next: SelectedField = { kind: "virtual", source: virtualSource, key, sourceType: fieldTypeMap.get(virtualSource) };
    setSelectedFields((current) => mergeSelected(current, [next]));
    setVirtualKey("");
  }

  function addFilter() {
    const firstField = selectedFields[0] ?? (hasEventTime ? { kind: "column" as const, name: "event_time", type: fieldTypeMap.get("event_time") } : undefined);
    if (!firstField) return;
    setFilters((current) => [
      ...current,
      { id: crypto.randomUUID(), field: firstField, operator: "equals", value: "", valueTo: "" }
    ]);
  }

  function updateFilter(id: string, patch: Partial<QueryFilter>) {
    setFilters((current) => current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
  }

  function removeFilter(id: string) {
    setFilters((current) => current.filter((filter) => filter.id !== id));
  }

  async function runQuery(estimateOnly = false) {
    setQueryLoading(true);
    setError("");

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...connection,
          fields: selectedFields,
          filters,
          limit,
          orderByEventTime: hasEventTime,
          estimateOnly
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to run query.");
      setQuery(data);
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : "Unable to run query.");
    } finally {
      setQueryLoading(false);
    }
  }

  function downloadCsv() {
    if (!query?.rows?.length) return;
    const columns = query.columns ?? Object.keys(query.rows[0]);
    const csv = [columns.join(","), ...query.rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${connection.table || "bigquery"}-preview.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local-only analyst tool</p>
          <h1>Amplitude BigQuery Explorer</h1>
          <p className="subhead">Browse raw Amplitude tables, build safe SQL from controls, preview rows, and export CSVs without storing data.</p>
        </div>
        <div className="status-pill">gcloud CLI server-side • No SQL editor • No persistence</div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid top-grid">
        <form className="card" onSubmit={loadSchema}>
          <div className="card-title">
            <span>1</span>
            <div>
              <h2>Connection & table</h2>
              <p>Uses the active Google Cloud CLI login on the Next.js server.</p>
            </div>
          </div>
          <label>
            Project ID
            <input value={connection.projectId} onChange={(event) => setConnection({ ...connection, projectId: event.target.value })} placeholder="my-bq-project" />
          </label>
          <label>
            Dataset
            <input value={connection.dataset} onChange={(event) => setConnection({ ...connection, dataset: event.target.value })} placeholder="amplitude" />
          </label>
          <label>
            Table
            <input value={connection.table} onChange={(event) => setConnection({ ...connection, table: event.target.value })} placeholder="events_2026" />
          </label>
          <button className="primary" disabled={schemaLoading}>{schemaLoading ? "Loading schema…" : "Load Schema"}</button>
        </form>

        <section className="card sql-card">
          <div className="card-title">
            <span>4</span>
            <div>
              <h2>Generated SQL preview</h2>
              <p>Read-only SQL generated from selected fields and AND filters.</p>
            </div>
          </div>
          <div className="estimate-row">
            <button className="secondary" disabled={!selectedFields.length || queryLoading} onClick={() => runQuery(true)}>{queryLoading ? "Estimating…" : "Estimate bytes"}</button>
            {query?.estimatedBytes ? <strong>{query.estimatedBytes}</strong> : <span>No estimate yet</span>}
          </div>
          {query?.warning ? <div className="warning">{query.warning}</div> : null}
          <pre>{query?.sql ?? "Load a schema, select fields, then estimate or preview to generate SQL."}</pre>
        </section>
      </section>

      <section className="grid workspace-grid">
        <section className="card schema-card">
          <div className="card-title">
            <span>2</span>
            <div>
              <h2>Schema browser</h2>
              <p>{schema.length ? `${schema.length} fields loaded. Select only the columns you need.` : "Load schema to begin."}</p>
            </div>
          </div>
          <div className="toolbar">
            <input value={schemaSearch} onChange={(event) => setSchemaSearch(event.target.value)} placeholder="Search fields, types, descriptions…" />
            <button className="secondary" disabled={!schema.length} onClick={selectCommonFields}>Select common fields</button>
            <button className="ghost" disabled={!selectedFields.length} onClick={() => setSelectedFields([])}>Clear</button>
          </div>
          <div className="field-list">
            {filteredSchema.map((field) => {
              const checked = selectedFields.some((selected) => selected.kind === "column" && selected.name === field.name);
              const common = COMMON_AMPLITUDE_FIELDS.includes(field.name as (typeof COMMON_AMPLITUDE_FIELDS)[number]);
              return (
                <label className={`field-row ${common ? "common" : ""}`} key={field.name}>
                  <input type="checkbox" checked={checked} onChange={() => toggleField(field)} />
                  <div>
                    <div className="field-main"><strong>{field.name}</strong>{common ? <span>Amplitude</span> : null}</div>
                    <div className="field-meta">{field.type}{field.mode ? ` · ${field.mode}` : ""}</div>
                    {field.description ? <p>{field.description}</p> : null}
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <aside className="stack">
          <section className="card">
            <div className="card-title compact">
              <span>+</span>
              <div>
                <h2>JSON virtual fields</h2>
                <p>Extract keys from Amplitude JSON columns.</p>
              </div>
            </div>
            <div className="inline-form">
              <select value={virtualSource} onChange={(event) => setVirtualSource(event.target.value as "event_properties" | "user_properties")}>
                <option value="event_properties">event_properties</option>
                <option value="user_properties">user_properties</option>
              </select>
              <input value={virtualKey} onChange={(event) => setVirtualKey(event.target.value)} placeholder="transaction_id" />
              <button className="secondary" onClick={addVirtualField}>Add</button>
            </div>
            <div className="chips">
              {selectedAliases.map((alias) => <span key={alias}>{alias}</span>)}
            </div>
          </section>

          <section className="card">
            <div className="card-title">
              <span>3</span>
              <div>
                <h2>Filters</h2>
                <p>AND filters only. Limit is always required.</p>
              </div>
            </div>
            <div className="limit-row">
              <label>
                Limit
                <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                  {LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option.toLocaleString()}</option>)}
                </select>
              </label>
              {hasEventTime ? <span className="hint">ORDER BY event_time DESC</span> : <span className="hint">No event_time detected</span>}
            </div>
            <button className="secondary full" disabled={!availableFilterFields.length && !hasEventTime} onClick={addFilter}>Add filter</button>
            <div className="filters">
              {filters.map((filter) => (
                <div className="filter-row" key={filter.id}>
                  <select value={fieldKey(filter.field)} onChange={(event) => updateFilter(filter.id, { field: selectedFields.find((field) => fieldKey(field) === event.target.value) ?? filter.field })}>
                    {availableFilterFields.map((field) => <option key={fieldKey(field)} value={fieldKey(field)}>{aliasForSelected(field)}</option>)}
                  </select>
                  <select value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as FilterOperator })}>
                    {Object.entries(operatorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {filter.operator !== "is_not_null" ? <input type={inputTypeForField(filter.field)} value={filter.value ?? ""} onChange={(event) => updateFilter(filter.id, { value: event.target.value })} placeholder="Value" /> : null}
                  {filter.operator === "between" ? <input type={inputTypeForField(filter.field)} value={filter.valueTo ?? ""} onChange={(event) => updateFilter(filter.id, { valueTo: event.target.value })} placeholder="End value" /> : null}
                  <button className="ghost danger" onClick={() => removeFilter(filter.id)}>Remove</button>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="card results-card">
        <div className="results-header">
          <div className="card-title compact">
            <span>5</span>
            <div>
              <h2>Results</h2>
              <p>{query?.rowCount !== undefined ? `${query.rowCount.toLocaleString()} rows returned` : "Preview rows from BigQuery, then download the returned result set."}</p>
            </div>
          </div>
          <div className="actions">
            <button className="primary" disabled={!selectedFields.length || queryLoading} onClick={() => runQuery(false)}>{queryLoading ? "Running…" : "Preview results"}</button>
            <button className="secondary" disabled={!query?.rows?.length} onClick={downloadCsv}>Download CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          {query?.rows?.length ? (
            <table>
              <thead>
                <tr>{(query.columns ?? Object.keys(query.rows[0])).map((column) => <th key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {query.rows.map((row, index) => (
                  <tr key={index}>{(query.columns ?? Object.keys(row)).map((column) => <td key={column}>{displayCell(row[column])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">No rows loaded yet.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function fieldKey(field: SelectedField) {
  return field.kind === "column" ? `column:${field.name}` : `virtual:${field.source}.${field.key}`;
}

function aliasForSelected(field: SelectedField) {
  if (field.kind === "column") return field.name.replace(/[^A-Za-z0-9_]/g, "_");
  return `${field.source}_${field.key.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function mergeSelected(current: SelectedField[], next: SelectedField[]) {
  const seen = new Set(current.map(fieldKey));
  return [...current, ...next.filter((field) => !seen.has(fieldKey(field)))];
}

function displayCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: unknown) {
  const serialized = typeof value === "object" && value !== null ? JSON.stringify(value) : value === null || value === undefined ? "" : String(value);
  return `"${String(serialized).replace(/"/g, '""')}"`;
}

function inputTypeForField(field: SelectedField) {
  if (field.kind === "virtual") return "text";

  switch (field.type?.toUpperCase()) {
    case "TIMESTAMP":
    case "DATETIME":
      return "datetime-local";
    case "DATE":
      return "date";
    case "TIME":
      return "time";
    case "INTEGER":
    case "INT64":
    case "FLOAT":
    case "FLOAT64":
    case "NUMERIC":
    case "BIGNUMERIC":
      return "number";
    default:
      return "text";
  }
}
