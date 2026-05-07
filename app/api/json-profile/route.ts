import { NextResponse } from "next/server";
import { profileJsonFields } from "../../lib/bigquery";
import { JsonProfileRequest } from "../../lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as JsonProfileRequest;
    const projectId = body.projectId?.trim();
    const dataset = body.dataset?.trim();
    const table = body.table?.trim();

    if (!projectId || !dataset || !table) {
      return NextResponse.json({ error: "Project ID, dataset, and table are required." }, { status: 400 });
    }

    const profile = await profileJsonFields({
      ...body,
      projectId,
      dataset,
      table
    });

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to profile JSON fields." }, { status: 500 });
  }
}
