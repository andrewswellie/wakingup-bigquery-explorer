import { NextResponse } from "next/server";
import { loadEventTypes } from "../../lib/bigquery";
import { EventTypesRequest } from "../../lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EventTypesRequest;
    const projectId = body.projectId?.trim();
    const dataset = body.dataset?.trim();
    const table = body.table?.trim();

    if (!projectId || !dataset || !table) {
      return NextResponse.json({ error: "Project ID, dataset, and table are required." }, { status: 400 });
    }

    const eventTypes = await loadEventTypes({ ...body, projectId, dataset, table, limit: body.limit ?? 500 });
    return NextResponse.json(eventTypes);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load event types." }, { status: 500 });
  }
}
