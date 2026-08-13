const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let ready = false;

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return null;
  return key.replace(/\\n/g, '\n');
}

function loadServiceAccountFromFile() {
  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!filePath) return null;

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Firebase service account file not found: ${absolutePath}`);
    return null;
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function buildCredential() {
  const serviceAccount = loadServiceAccountFromFile();
  if (serviceAccount) {
    return {
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (projectId && clientEmail && privateKey) {
    return {
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    };
  }

  return null;
}

function initFirebase() {
  if (ready && getApps().length) return true;

  if (getApps().length) {
    ready = true;
    return true;
  }

  const config = buildCredential();
  if (!config) return false;

  initializeApp(config);
  ready = true;
  return true;
}

function isFirebaseConfigured() {
  return Boolean(initFirebase());
}

function auth() {
  if (!initFirebase()) return null;
  return getAuth();
}

async function verifyFirebaseIdToken(idToken) {
  const authClient = auth();
  if (!authClient) {
    const err = new Error(
      'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH to your JSON file (or FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).'
    );
    err.code = 'FIREBASE_NOT_CONFIGURED';
    throw err;
  }

  return authClient.verifyIdToken(idToken);
}

async function updateFirebasePasswordByEmailOrPhone({ email, phone, newPassword }) {
  const authClient = auth();
  if (!authClient) return { updated: false, reason: 'not_configured' };

  let userRecord = null;

  if (email) {
    try {
      userRecord = await authClient.getUserByEmail(email);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
  }

  if (!userRecord && phone) {
    try {
      userRecord = await authClient.getUserByPhoneNumber(phone);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
  }

  if (!userRecord) return { updated: false, reason: 'user_not_found' };

  await authClient.updateUser(userRecord.uid, { password: newPassword });
  return { updated: true, uid: userRecord.uid };
}

module.exports = {
  initFirebase,
  isFirebaseConfigured,
  verifyFirebaseIdToken,
  updateFirebasePasswordByEmailOrPhone,
};
