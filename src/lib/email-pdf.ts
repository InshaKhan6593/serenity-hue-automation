import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** WinAnsi (the standard PDF fonts) cannot encode every character; swap the common ones and drop the rest. */
function sanitize(s: string) {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff\u20ac\n]/g, "");
}

/** Renders an email-body receipt as a simple PDF so every invoice has a document in Dropbox. */
export async function emailToPdf(email: { fromName: string | null; fromEmail: string | null; subject: string | null; receivedAt: Date; bodyText: string }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 10;
  const margin = 50;
  const [width, height] = [595, 842]; // A4
  const maxWidth = width - margin * 2;

  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const line = (text: string, f = font) => {
    if (y < margin) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= size * 1.4;
  };

  const wrap = (text: string, f = font) => {
    for (const para of sanitize(text).split("\n")) {
      let current = "";
      for (const word of para.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > maxWidth && current) {
          line(current, f);
          current = word;
        } else current = next;
      }
      line(current, f);
    }
  };

  wrap(`From: ${[email.fromName, email.fromEmail && `<${email.fromEmail}>`].filter(Boolean).join(" ")}`, bold);
  wrap(`Subject: ${email.subject ?? ""}`, bold);
  wrap(`Date: ${email.receivedAt.toUTCString()}`, bold);
  y -= size;
  wrap(email.bodyText);

  return Buffer.from(await pdf.save());
}
