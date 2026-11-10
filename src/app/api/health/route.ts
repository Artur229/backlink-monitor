import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Railway healthcheck: 200 when the DB answers. Not behind the dashboard password. */
export async function GET() {
  try {
    await prisma.$queryRaw`select 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
