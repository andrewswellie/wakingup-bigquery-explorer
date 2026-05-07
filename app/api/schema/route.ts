import { NextResponse } from "next/server";
import { getSchema, hasEventTime, sortSchema } from "../../lib/bigquery";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string; dataset?: string; table?: string };
    const projectId = body.projectId?.trim();
    const dataset = body.dataset?.trim();
    const table = body.table?.trim();

    if (!projectId || !dataset || !table) {
      return NextResponse.json({ error: "Project ID, dataset, and table are required." }, { status: 400 });
    }

    const fields = sortSchema(await getSchema(projectId, dataset, table));
    return NextResponse.json({ fields, hasEventTime: hasEventTime(fields) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load schema." }, { status: 500 });
  }
}
