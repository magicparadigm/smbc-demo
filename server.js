require('dotenv').config();
const express = require('express');
const docusign = require('docusign-esign');
const fs = require('fs');
const path = require('path');

const app = express();
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── DocuSign configuration ────────────────────────────────────────────────────

const DS_OAUTH_SERVER = 'https://account-d.docusign.com'; // demo sandbox
const DS_BASE_PATH    = 'https://demo.docusign.net/restapi';
const SIGNER_CLIENT_ID = '1000'; // arbitrary ID that ties the envelope to the embedded session

function loadPrivateKey() {
  if (process.env.DS_PRIVATE_KEY_PATH) {
    const keyPath = path.resolve(process.env.DS_PRIVATE_KEY_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found: ${keyPath}`);
    }
    return fs.readFileSync(keyPath);
  }
  if (process.env.DS_PRIVATE_KEY) {
    return Buffer.from(process.env.DS_PRIVATE_KEY.replace(/\\n/g, '\n'));
  }
  throw new Error('No DocuSign private key configured. Set DS_PRIVATE_KEY_PATH in .env');
}

// ── DocuSign JWT authentication ───────────────────────────────────────────────

async function getAccessToken() {
  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(DS_OAUTH_SERVER.replace('https://', ''));

  let results;
  try {
    results = await apiClient.requestJWTUserToken(
      process.env.DS_CLIENT_ID,
      process.env.DS_USER_ID,
      ['signature'],
      loadPrivateKey(),
      3600
    );
  } catch (err) {
    // JWT consent not yet granted — return the consent URL to the caller
    if (err.response?.body?.error === 'consent_required') {
      const consentUrl =
        `${DS_OAUTH_SERVER}/oauth/auth?response_type=code` +
        `&scope=signature%20impersonation` +
        `&client_id=${process.env.DS_CLIENT_ID}` +
        `&redirect_uri=https://developers.docusign.com/platform/auth/consent`;
      const consentError = new Error('DocuSign consent required');
      consentError.consentUrl = consentUrl;
      throw consentError;
    }
    throw err;
  }

  return results.body.access_token;
}

// ── Create envelope from template + return embedded signing URL ───────────────
// Signer 1 (embedded): signs in-page via an iframe.
// Signer 2 (remote):   receives an email with a signing link — no clientUserId.

async function createSigningSession(
  signer1Email, signer1Name,
  signer2Email, signer2Name,
  returnUrl
) {
  const accessToken = await getAccessToken();

  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(DS_BASE_PATH);
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

  const envelopesApi = new docusign.EnvelopesApi(apiClient);

  const envelopeDefinition = {
    emailSubject: 'Please sign — SMBC Group Americas Demo',
    templateId: process.env.DS_TEMPLATE_ID,
    templateRoles: [
      {
        // Embedded signer — clientUserId required for recipient view URL
        email:        signer1Email,
        name:         signer1Name,
        roleName:     process.env.DS_SIGNER1_ROLE || 'Signer 1',
        clientUserId: SIGNER_CLIENT_ID,
      },
      {
        // Remote signer — receives signing link by email; no clientUserId
        email:    signer2Email,
        name:     signer2Name,
        roleName: process.env.DS_SIGNER2_ROLE || 'Signer 2',
      },
    ],
    status: 'sent',
  };

  const envelopeResult = await envelopesApi.createEnvelope(process.env.DS_ACCOUNT_ID, {
    envelopeDefinition,
  });

  const envelopeId = envelopeResult.envelopeId;

  // Request the embedded (recipient) view URL for signer 1 only
  const recipientViewResult = await envelopesApi.createRecipientView(
    process.env.DS_ACCOUNT_ID,
    envelopeId,
    {
      recipientViewRequest: {
        returnUrl,
        authenticationMethod: 'none',
        email:        signer1Email,
        userName:     signer1Name,
        clientUserId: SIGNER_CLIENT_ID,
      },
    }
  );

  return { url: recipientViewResult.url, envelopeId };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/create-signing-session
// Body: { signer1Email, signer1Name, signer2Email, signer2Name }
app.post('/api/create-signing-session', async (req, res) => {
  const { signer1Email, signer1Name, signer2Email, signer2Name } = req.body;

  if (!signer1Email || !signer1Name || !signer2Email || !signer2Name) {
    return res.status(400).json({ error: 'signer1Email, signer1Name, signer2Email, and signer2Name are required' });
  }

  const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
  const returnUrl = `${origin}/signing-complete.html`;

  try {
    const { url, envelopeId } = await createSigningSession(
      signer1Email, signer1Name,
      signer2Email, signer2Name,
      returnUrl
    );
    return res.json({ url, envelopeId });
  } catch (err) {
    console.error('DocuSign error:', err.message);

    if (err.consentUrl) {
      return res.status(403).json({
        error: 'consent_required',
        message: 'DocuSign consent has not been granted yet.',
        consentUrl: err.consentUrl,
      });
    }

    return res.status(500).json({ error: 'Failed to create signing session', details: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SMBC DocuSign demo running → http://localhost:${PORT}`);
});
