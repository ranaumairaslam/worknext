require('dotenv').config();
const nodemailer = require('nodemailer');

function mask(value) {
  const text = String(value || '');
  if (!text) return '(empty)';
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

async function main() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secureSetting = String(process.env.SMTP_SECURE || '').toLowerCase();
  const secure =
    secureSetting === 'true' ? true : secureSetting === 'false' ? false : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || user;

  console.log('SMTP config loaded:');
  console.log(`  host=${host || '(empty)'}`);
  console.log(`  port=${port}`);
  console.log(`  secure=${secure}`);
  console.log(`  user=${user || '(empty)'}`);
  console.log(`  pass=${pass ? 'set' : '(empty)'}`);
  console.log(`  from=${from || '(empty)'}`);

  if (!host || !user || !pass) {
    console.error('VERIFY_FAILED: SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
    process.exit(1);
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: false,
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  try {
    await transport.verify();
    console.log('VERIFY_OK: SMTP authentication succeeded');
  } catch (error) {
    console.error('VERIFY_FAILED:', error.message);
    if (error.code) console.error('CODE:', error.code);
    if (error.response) console.error('RESPONSE:', error.response);
    process.exit(1);
  } finally {
    transport.close();
  }
}

main();
