const validator = require('validator');
const { sendMail } = require('../../config/mail');

const CONTACT_EMAIL = 'info@softcenteric.com';

function getField(body, ...names) {
  for (const name of names) {
    if (body?.[name] !== undefined && body[name] !== null) {
      const value = String(body[name]).trim();
      if (value) return value;
    }
  }
  return '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function submitContactMessage(req, res) {
  const fullName = getField(req.body, 'FullName', 'fullName');
  const email = getField(req.body, 'Email', 'email').toLowerCase();
  const subject = getField(req.body, 'Subject', 'subject');
  const message = getField(req.body, 'Message', 'message');

  const errors = {};

  if (!fullName) errors.FullName = 'FullName is required';
  else if (fullName.length > 255) {
    errors.FullName = 'FullName must be 255 characters or fewer';
  }

  if (!email) errors.Email = 'Email is required';
  else if (!validator.isEmail(email)) {
    errors.Email = 'Email must be a valid email address';
  }

  if (!subject) errors.Subject = 'Subject is required';
  else if (subject.length > 255) {
    errors.Subject = 'Subject must be 255 characters or fewer';
  }

  if (!message) errors.Message = 'Message is required';
  else if (message.length > 5000) {
    errors.Message = 'Message must be 5000 characters or fewer';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      code: 400,
      message: 'Validation failed',
      errors,
    });
  }

  try {
    await sendMail({
      to: CONTACT_EMAIL,
      subject: `Contact Us: ${subject}`,
      text: [
        `Name: ${fullName}`,
        `Email: ${email}`,
        `Subject: ${subject}`,
        '',
        message,
      ].join('\n'),
      html: `
        <h2>Contact Us Message</h2>
        <p><strong>Name:</strong> ${escapeHtml(fullName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <hr>
        <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>
      `,
    });

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Your message has been sent successfully',
    });
  } catch (error) {
    console.error('Contact email error:', error);
    return res.status(503).json({
      success: false,
      code: 503,
      message: 'Unable to send your message right now. Please try again later.',
    });
  }
}

module.exports = {
  submitContactMessage,
};
