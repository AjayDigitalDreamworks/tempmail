const { SMTPServer } = require('smtp-server');
const express = require('express');
const cors = require('cors');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const TEMP_EMAIL_DOMAIN = 'devamail.tem';
const mailboxes = {};


const EMAIL_TTL = 1000 * 60 * 60;


function generateRandomEmail() {
  const randomStr = crypto.randomBytes(4).toString('hex'); 
  return `${randomStr}@${TEMP_EMAIL_DOMAIN}`;
}

// Helper: clean expired emails (run periodically)
function cleanupExpiredEmails() {
  const now = Date.now();
  for (const email in mailboxes) {
    mailboxes[email] = mailboxes[email].filter(msg => (now - msg.receivedAt) < EMAIL_TTL);
    // If mailbox empty, delete key to save memory
    if (mailboxes[email].length === 0) delete mailboxes[email];
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEmails, 5 * 60 * 1000);

// SMTP Server setup
const smtpServer = new SMTPServer({
  authOptional: true,
  onRcptTo(address, session, callback) {
    const recipient = address.address.toLowerCase();
    if (!mailboxes[recipient]) {
      return callback(new Error('550 Invalid recipient: mailbox does not exist'));
    }
    callback(); // accept recipient
  },
  onData(stream, session, callback) {
    simpleParser(stream)
      .then(parsed => {
        const recipient = session.envelope.rcptTo[0].address.toLowerCase();

        const mail = {
          id: crypto.randomUUID(),
          from: parsed.from?.text || '',
          to: parsed.to?.text || '',
          subject: parsed.subject || '',
          date: parsed.date || new Date(),
          text: parsed.text || '',
          html: parsed.html || '',
          receivedAt: Date.now(),
        };

        mailboxes[recipient].push(mail);
        console.log(`Received email for ${recipient}: "${mail.subject}"`);
        callback(null);
      })
      .catch(err => {
        console.error('Parsing error:', err);
        callback(err);
      });
  },
  disabledCommands: ['STARTTLS'],
  logger: false,
});

const SMTP_PORT = process.env.SMTP_PORT || 2525;
smtpServer.listen(SMTP_PORT, () => {
  console.log(`SMTP Server listening on port ${SMTP_PORT}`);
});

// API: Create new temp email address
app.post('/create-email', (req, res) => {
  const newEmail = generateRandomEmail();
  mailboxes[newEmail] = [];
  res.json({ email: newEmail });
});

// API: List all temp emails (optional, for debugging/admin)
app.get('/emails/list', (req, res) => {
  res.json(Object.keys(mailboxes));
});

// API: Get emails for a specific temp email (with pagination)
app.get('/emails/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  if (!mailboxes[email]) {
    return res.status(404).json({ error: 'Mailbox not found' });
  }

  const start = (page - 1) * limit;
  const end = start + limit;
  const emailsPage = mailboxes[email].slice().reverse().slice(start, end); // latest first

  res.json({
    page,
    limit,
    totalEmails: mailboxes[email].length,
    emails: emailsPage,
  });
});

// API: Get single email by id for a temp email
app.get('/emails/:email/:id', (req, res) => {
  const { email, id } = req.params;
  const mailbox = mailboxes[email.toLowerCase()];
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });

  const emailData = mailbox.find(m => m.id === id);
  if (!emailData) return res.status(404).json({ error: 'Email not found' });

  res.json(emailData);
});

// API: Delete all emails for a temp email (optional)
app.delete('/emails/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  if (!mailboxes[email]) {
    return res.status(404).json({ error: 'Mailbox not found' });
  }
  mailboxes[email] = [];
  res.json({ message: `All emails deleted for ${email}` });
});

// API: Delete a single email by id
app.delete('/emails/:email/:id', (req, res) => {
  const { email, id } = req.params;
  if (!mailboxes[email]) return res.status(404).json({ error: 'Mailbox not found' });

  mailboxes[email] = mailboxes[email].filter(m => m.id !== id);
  res.json({ message: `Email ${id} deleted for ${email}` });
});

// Start Express API
const API_PORT = process.env.API_PORT || 3001;
app.listen(API_PORT, () => {
  console.log(`API Server listening on port ${API_PORT}`);
});
