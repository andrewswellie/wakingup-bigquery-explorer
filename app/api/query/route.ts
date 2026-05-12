import { NextResponse } from "next/server";
import { buildQuery, estimateQuery, runQuery } from "../../lib/bigquery";
import { QueryRequest } from "../../lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QueryRequest;
    const { sql, params, columns } = buildQuery(body);
    const estimate = await estimateQuery(body.projectId, sql, params);

    if (body.estimateOnly) {
      return NextResponse.json({
        sql,
        params,
        columns,
        estimatedBytes: estimate.formatted,
        estimatedBytesNumber: estimate.totalBytesProcessed,
        estimatedCost: estimate.formattedCost,
        estimatedCostUsd: estimate.estimatedCostUsd,
        costEstimateNote: estimate.costEstimateNote,
        warning: estimate.warning
      });
    }

    const rows = await runQuery(body.projectId, sql, params);
    return NextResponse.json({
      sql,
      params,
      columns,
      estimatedBytes: estimate.formatted,
      estimatedBytesNumber: estimate.totalBytesProcessed,
      estimatedCost: estimate.formattedCost,
      estimatedCostUsd: estimate.estimatedCostUsd,
      costEstimateNote: estimate.costEstimateNote,
      warning: estimate.warning,
      rows,
      rowCount: rows.length
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run query." }, { status: 500 });
  }
}
