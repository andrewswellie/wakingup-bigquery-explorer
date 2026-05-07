# Amplitude BigQuery Explorer

A polished, lightweight, local-only Next.js app for analysts who need to explore existing Amplitude raw/event data in BigQuery without writing SQL.

The app connects directly to BigQuery from server-side API routes, reads short-lived access tokens from the Google Cloud CLI, and never stores query results or credentials. It is intentionally not a generic BI platform: it focuses on selecting fields, adding safe filters, previewing rows, and exporting the returned rows as CSV.

## What it does

- Connects to an existing BigQuery project, dataset, and table.
- Loads and searches table schema metadata.
- Highlights common Amplitude fields such as `user_id`, `event_time`, `event_type`, `device_id`, `session_id`, `insert_id`, `uuid`, `event_properties`, and `user_properties`.
- Lets you select explicit output fields. `SELECT *` is not generated.
- Adds virtual fields from JSON columns such as:
  - `event_properties.transaction_id`
  - `event_properties.revenue`
  - `user_properties.affiliate_id`
- Builds read-only, generated SQL from UI selections only.
- Supports AND filters for equals, contains, starts with, greater than, less than, between, and is not null.
- Requires a limit of 100, 500, 1,000, or 10,000 rows. The default is 100.
- Estimates bytes processed with a BigQuery dry run before execution when requested.
- Orders by `event_time DESC` automatically when `event_time` exists in the table schema.
- Renders a preview table and exports the returned result set to CSV in the browser.

## What it deliberately does not do

- User accounts
- Production authentication
- Deployment or hosted infrastructure config
- Natural-language-to-SQL
- Arbitrary SQL editing
- Database persistence
- External storage for CSV exports

## Prerequisites

- Node.js 20 or newer recommended.
- npm.
- Google Cloud CLI installed and configured.
- BigQuery access to the project, dataset, and table you want to inspect.

## Google authentication

This local app gets credentials directly from the Google Cloud CLI on the server-side Next.js process. It shells out to `gcloud auth print-access-token`, passes that short-lived token to the BigQuery Node.js client, and refreshes the in-memory client cache periodically.

Sign in with the normal gcloud CLI auth flow:

```bash
gcloud auth login
```

Confirm that the CLI can mint an access token before starting the app:

```bash
gcloud auth print-access-token
```

If your BigQuery data is billed to a specific Google Cloud project, make sure your local gcloud context and IAM permissions are set appropriately. You can set the active CLI project with:

```bash
gcloud config set project your-project-id
```

## Required BigQuery permissions

Your Google identity needs permissions that allow the app to:

- Read table metadata/schema, for example `bigquery.tables.get`.
- Run query dry-runs and queries, for example `bigquery.jobs.create` on the project used for jobs.
- Read table data, for example `bigquery.tables.getData` or equivalent dataset/table access.

Common roles that may satisfy these needs in internal environments include BigQuery Data Viewer on the relevant dataset/table and BigQuery Job User on the project. Use the least privilege permissions that match your company policy.

## Local setup

Install dependencies:

```bash
npm install
```

Optionally copy `.env.example` to `.env.local` if you want default values prefilled in the UI:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
NEXT_PUBLIC_DEFAULT_PROJECT_ID=your-project-id
NEXT_PUBLIC_DEFAULT_DATASET=your_dataset
NEXT_PUBLIC_DEFAULT_TABLE=your_table
```

These variables only prefill form fields. Google credentials, service account JSON, and access tokens are not stored in environment variables by this app.

## Run locally

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

## Analyst workflow

1. Enter the BigQuery project ID, dataset, and table.
2. Click **Load Schema**.
3. Search or browse the schema and select output fields.
4. Use **Select common fields** if you want typical Amplitude columns.
5. Optionally add JSON virtual fields from `event_properties` or `user_properties`.
6. Optionally add AND filters.
7. Select a required LIMIT.
8. Click **Estimate bytes** to dry-run the generated query.
9. Click **Preview results** to run the query.
10. Click **Download CSV** to export only the returned rows.

## Notes on JSON extraction

For virtual fields, the app generates BigQuery `JSON_VALUE` expressions. If the source column is a BigQuery `STRING`, it uses `SAFE.PARSE_JSON` first. If the source column is a BigQuery `JSON`, it reads from the JSON column directly.

Virtual field aliases are cleaned for CSV/table output. For example:

- `event_properties.transaction_id` becomes `event_properties_transaction_id`
- `user_properties.affiliate_id` becomes `user_properties_affiliate_id`

## Security and local-only behavior

- BigQuery access tokens are requested from the Google Cloud CLI only inside server-side API routes.
- The browser never receives gcloud access tokens, ADC files, or service account credentials.
- Query results are kept in browser memory for preview/export only.
- No database or server-side persistence is included.
- No production auth or deployment config is included.
