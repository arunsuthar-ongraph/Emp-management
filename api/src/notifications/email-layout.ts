/** Shared HTML shell for all system emails, plus an HTML escaper for user-supplied text. */

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function emailLayout(company: string, title: string, body: string, button?: { url: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#111827">
    <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#4f46e5;color:#fff;padding:16px 24px;font-weight:600">${esc(company)} · PeopleDesk</div>
      <div style="padding:24px">
        <h2 style="margin:0 0 8px;font-size:18px">${title}</h2>
        ${body}
        ${button ? `<p style="margin:24px 0 8px"><a href="${esc(button.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${esc(button.label)}</a></p>` : ''}
      </div>
      <div style="padding:12px 24px;background:#f9fafb;color:#9ca3af;font-size:12px">This is an automated message from your HR system. Please do not reply.</div>
    </div></body></html>`;
  }
