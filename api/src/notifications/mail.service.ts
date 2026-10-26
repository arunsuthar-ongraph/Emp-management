import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ROOT_DOMAIN } from '../common/config';

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Sends email over SMTP (settings in .env). Sending never blocks or fails the request that
 * triggered it: mails are sent in the background with up to 3 attempts, and failures are logged.
 * Without SMTP_HOST, mails are only written to the log.
 */
@Injectable()
export class MailService {
  private log = new Logger('Mail');
  private transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;

  send(mail: Mail) {
    const to = [...new Set([mail.to].flat().filter(Boolean))];
    if (!to.length) return;
    void this.deliver({ ...mail, to });
  }

  private async deliver(mail: Mail & { to: string[] }, attempt = 1): Promise<void> {
    if (!this.transport) {
      this.log.log(`[not sent: SMTP_HOST empty] to=${mail.to.join(',')} subject="${mail.subject}"`);
      return;
    }
    try {
      await this.transport.sendMail({ from: process.env.MAIL_FROM || `no-reply@${ROOT_DOMAIN || 'localhost'}`, ...mail });
      this.log.log(`sent to=${mail.to.join(',')} subject="${mail.subject}"`);
    } catch (e) {
      if (attempt < 3) {
        setTimeout(() => void this.deliver(mail, attempt + 1), attempt * 5000);
      } else {
        this.log.error(`failed after 3 attempts to=${mail.to.join(',')} subject="${mail.subject}": ${(e as Error).message}`);
      }
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
