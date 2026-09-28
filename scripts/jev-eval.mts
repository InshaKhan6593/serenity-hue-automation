// Dry run: re-asks Jev about stored emails and prints old status vs new route. Changes nothing.
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { emails } from "../src/db/schema";
import { candidateAttachments, getEmail, gmailClient } from "../src/lib/gmail";
import { classifyEmail, routeEmail } from "../src/lib/jev";

const gmail = await gmailClient();
const rows = await db.select().from(emails).where(sql`${emails.status} in ('invoice','error')
  or ${emails.subject} ~* '(receipt|invoice|bill|order|payment|paid|purchase|subscription|renew|charge|booking|ticket|confirm)'
  or ${emails.id} in (select id from emails where status='ignored' order by md5(id) limit 15)`);
for (const r of rows) {
  const e = await getEmail(gmail, r.id);
  const candidates = candidateAttachments(e.attachments);
  const j = await classifyEmail({ ...e, attachments: candidates });
  const route = routeEmail(j, candidates.length > 0);
  console.log(`${r.status.padEnd(7)} → ${(route.to + (route.to === "invoice" && route.unpaid ? "(unpaid)" : "")).padEnd(16)} | cat ${j.category.padEnd(17)} ${String(Math.round(j.probability * 100)).padStart(3)}% pay ${j.payment.status.padEnd(17)} ${String(Math.round(j.payment.probability * 100)).padStart(3)}% | ${(e.fromName ?? e.fromEmail ?? "").slice(0, 16).padEnd(16)} | ${(e.subject ?? "").slice(0, 50)}`);
  await new Promise((res) => setTimeout(res, 300));
}
process.exit(0);
