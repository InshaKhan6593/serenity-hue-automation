import { NextResponse, type NextRequest } from "next/server";
import { getEmail, gmailClient } from "@/lib/gmail";

/** Loads an email live from Gmail (we don't store bodies of ignored emails). Returns plain text only. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/emails/[id]">) {
  const { id } = await ctx.params;
  try {
    const email = await getEmail(await gmailClient(), id);
    return NextResponse.json({
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      subject: email.subject,
      receivedAt: email.receivedAt,
      bodyText: email.bodyText,
      attachments: email.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
