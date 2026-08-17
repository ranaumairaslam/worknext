const nodemailer = require('nodemailer');

function isMailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
  );
}

function getSmtpPort() {
  const parsed = Number(process.env.SMTP_PORT || 587);
  return Number.isFinite(parsed) ? parsed : 587;
}

function getSmtpSecure(port) {
  const secureSetting = String(process.env.SMTP_SECURE || '').toLowerCase();
  if (secureSetting === 'true') return true;
  if (secureSetting === 'false') return false;
  return port === 465;
}

function getMailFrom() {
  if (process.env.EMAIL_FROM) {
    return process.env.EMAIL_FROM;
  }

  const fromName = process.env.MAIL_FROM_NAME || 'WorkNest';
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  return `"${fromName}" <${fromAddress}>`;
}

function createTransport() {
  if (!isMailConfigured()) return null;

  const port = getSmtpPort();

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: getSmtpSecure(port),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });
}

async function sendMail({ to, subject, text, html }) {
  const transport = createTransport();
  if (!transport) {
    const err = new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env'
    );
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  return transport.sendMail({
    from: getMailFrom(),
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  isMailConfigured,
  sendMail,
  getMailFrom,
};
