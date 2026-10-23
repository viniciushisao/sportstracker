import type { Config } from '../config.js';
import type { Email } from '../types.js';
import { escapeHtml } from './render.js';
export function healthEmail(email: Email | null, label: string, config: Config): Email {
  const message = [
    'Everything looks fine.',
    label === 'Superliga' ? 'No games today or yesterday; standings are included below.' : 'No qualifying Toronto home games today or tomorrow.',
    config.fixtureDir ? 'Offline preview: saved schedules validated (live sources were not contacted).' : 'Current official schedules fetched and validated successfully.',
    'Parser checks against saved examples passed, including rejection of invalid schedules.',
    `Checked for ${config.date} (${config.timezone}).`,
  ].join('\n');
  const block = `<section style="padding:16px;background:#edf7ef;color:#172033"><h2>Daily health check</h2><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p></section>`;
  if (email) return { ...email, text: `${message}\n\n${email.text}`, html: email.html?.replace(/(<body[^>]*>)/i, `$1${block}`) };
  const subject = `${label} — Everything looks fine — ${config.date}`;
  return { subject, text: `${subject}\n\n${message}`, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="font-family:Arial,Helvetica,sans-serif">${block}</body></html>` };
}
