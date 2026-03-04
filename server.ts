import express from 'express';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.enable('trust proxy');

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
  next();
});

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-user-id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const RC_CLIENT_ID = process.env.RC_CLIENT_ID;
const RC_CLIENT_SECRET = process.env.RC_CLIENT_SECRET;
const RC_SERVER_URL = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

const CLIO_CLIENT_ID = process.env.CLIO_CLIENT_ID;
const CLIO_CLIENT_SECRET = process.env.CLIO_CLIENT_SECRET;
const CLIO_AUTH_URL = 'https://app.clio.com/oauth/authorize';
const CLIO_TOKEN_URL = 'https://app.clio.com/oauth/token';
const CLIO_API_URL = 'https://app.clio.com/api/v4';

if (!RC_CLIENT_ID || !RC_CLIENT_SECRET) {
  console.error('Missing RC_CLIENT_ID or RC_CLIENT_SECRET environment variables');
  // We don't throw here to allow the server to start for health checks, 
  // but auth routes will fail.
}

// Helper to refresh Clio token
async function refreshClioToken(userId: string, refreshToken: string) {
  try {
    const response = await fetch(CLIO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIO_CLIENT_ID,
        client_secret: CLIO_CLIENT_SECRET,
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw new Error('Failed to refresh Clio token');
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    await db.run(`
      UPDATE service_connections 
      SET access_token = ?, refresh_token = ?, expires_at = ?
      WHERE user_id = ? AND provider = 'clio'
    `, [data.access_token, data.refresh_token, expiresAt, userId]);

    return data.access_token;
  } catch (error) {
    console.error('Error refreshing Clio token:', error);
    throw error;
  }
}

// Helper to make authenticated Clio API calls
async function clioFetch(url: string, options: any, userId: string) {
  const connection = await db.get('SELECT * FROM service_connections WHERE user_id = ? AND provider = ?', [userId, 'clio']);
  if (!connection) throw new Error('Clio connection not found');

  let accessToken = connection.access_token;

  // Check if token is expired or about to expire (within 5 mins)
  if (new Date(connection.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    accessToken = await refreshClioToken(userId, connection.refresh_token);
  }

  let res = await fetch(`${CLIO_API_URL}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (res.status === 401) {
    // Try one more refresh if 401
    accessToken = await refreshClioToken(userId, connection.refresh_token);
    res = await fetch(`${CLIO_API_URL}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }

  return res;
}

// HubSpot Integration
const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HUBSPOT_API_URL = 'https://api.hubapi.com';

// Helper to refresh HubSpot token
async function refreshHubSpotToken(userId: string, refreshToken: string) {
  try {
    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: HUBSPOT_CLIENT_ID || '',
        client_secret: HUBSPOT_CLIENT_SECRET || '',
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw new Error('Failed to refresh HubSpot token');
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    await db.run(`
      UPDATE service_connections 
      SET access_token = ?, refresh_token = ?, expires_at = ?
      WHERE user_id = ? AND provider = 'hubspot'
    `, [data.access_token, data.refresh_token, expiresAt, userId]);

    return data.access_token;
  } catch (error) {
    console.error('Error refreshing HubSpot token:', error);
    throw error;
  }
}

// Helper to make authenticated HubSpot API calls
async function hubSpotFetch(url: string, options: any, userId: string) {
  const connection = await db.get('SELECT * FROM service_connections WHERE user_id = ? AND provider = ?', [userId, 'hubspot']);
  if (!connection) throw new Error('HubSpot connection not found');

  let accessToken = connection.access_token;

  // Check if token is expired or about to expire (within 5 mins)
  if (new Date(connection.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    accessToken = await refreshHubSpotToken(userId, connection.refresh_token);
  }

  let res = await fetch(`${HUBSPOT_API_URL}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (res.status === 401) {
    // Try one more refresh if 401
    accessToken = await refreshHubSpotToken(userId, connection.refresh_token);
    res = await fetch(`${HUBSPOT_API_URL}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }

  return res;
}

app.get('/api/auth/hubspot/url', (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/hubspot/callback`;
  const params = new URLSearchParams({
    client_id: HUBSPOT_CLIENT_ID || '',
    redirect_uri: redirectUri,
    scope: 'crm.objects.contacts.read crm.objects.contacts.write', // Basic scope for contacts
    state: userId, 
  });
  res.json({ url: `${HUBSPOT_AUTH_URL}?${params.toString()}` });
});

app.get('/api/auth/hubspot/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/hubspot/callback`;

  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
          <h2 style="color: #ef4444;">HubSpot Authentication Error</h2>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${error_description || 'No description provided.'}</p>
        </body>
      </html>
    `);
  }

  try {
    const tokenResponse = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HUBSPOT_CLIENT_ID || '',
        client_secret: HUBSPOT_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        code: code as string
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.message || 'Failed to get HubSpot token');
    }

    // Get Portal ID (Hub ID)
    const infoResponse = await fetch(`${HUBSPOT_API_URL}/oauth/v1/access-tokens/${tokenData.access_token}`);
    const infoData = await infoResponse.json();
    
    if (!infoResponse.ok) {
      throw new Error('Failed to get HubSpot account info');
    }
    
    const portalId = infoData.hub_id;
    const userId = state as string;

    // Verify user exists before inserting to avoid FK constraint errors
    const userExists = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!userExists) {
      return res.status(401).send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
            <h2 style="color: #ef4444;">Session Expired</h2>
            <p>Your user session was not found. Please go back to the app, logout, and login again with RingCentral.</p>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'User session not found' }, '*');
                  window.close();
                }
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    await db.run(`
      INSERT INTO service_connections (id, user_id, provider, access_token, refresh_token, external_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        external_id = excluded.external_id,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `, [
      uuidv4(),
      userId,
      'hubspot',
      tokenData.access_token,
      tokenData.refresh_token,
      String(portalId),
      expiresAt
    ]);

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'HUBSPOT_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>HubSpot authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);

  } catch (error: any) {
    console.error('HubSpot OAuth error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// HubSpot Webhook Handler
app.post('/api/hubspot/webhook', async (req, res) => {
  const events = req.body;
  
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(200).send('No events');
  }

  // Assuming all events in a batch are for the same portal
  const portalId = events[0].portalId || events[0].hub_id; 
  
  if (!portalId) {
    console.error('HubSpot webhook missing portalId');
    return res.status(400).send('Missing portalId');
  }

  try {
    // Find the user associated with this portal
    const connection = await db.get('SELECT user_id FROM service_connections WHERE provider = ? AND external_id = ?', ['hubspot', String(portalId)]);
    
    if (!connection) {
      console.warn(`No user found for HubSpot portal ${portalId}`);
      return res.status(200).send('Ignored: No user connection');
    }

    const userId = connection.user_id;

    // Find all HubSpot notifiers for this user
    const notifiers = await db.query('SELECT * FROM notifiers WHERE user_id = ? AND provider = ?', [userId, 'hubspot']);

    if (notifiers.length === 0) {
      console.log(`No HubSpot notifiers configured for user ${userId}`);
      return res.status(200).send('Ignored: No notifiers');
    }

    // Process each event against each notifier
    for (const event of events) {
      // Enrich event with contact details if it's a contact event
      let enrichedEvent = { ...event };
      
      if (event.subscriptionType === 'contact.creation' || event.subscriptionType === 'contact.propertyChange') {
        try {
          const contactRes = await hubSpotFetch(`/crm/v3/objects/contacts/${event.objectId}?properties=firstname,lastname,email,phone,company,jobtitle`, {
            method: 'GET'
          }, userId);
          
          if (contactRes.ok) {
            const contactData = await contactRes.json();
            enrichedEvent.contact = contactData;
          }
        } catch (e) {
          console.error('Failed to fetch contact details from HubSpot', e);
        }
      }

      for (const notifier of notifiers) {
        const traceId = uuidv4();
        let generatedCard = '';
        let status = 'success';
        let outboundResponse = '';

        try {
          // Generate Card
          let templateStr = notifier.adaptive_card_template;
          
          // Replace tokens
          templateStr = templateStr.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (match: string, path: string) => {
            const keys = path.split('.');
            let value: any = enrichedEvent;
            for (const key of keys) {
              if (value && typeof value === 'object' && key in value) {
                value = value[key];
              } else {
                return match; 
              }
            }
            if (typeof value === 'object') {
              return JSON.stringify(value);
            }
            // Escape double quotes and newlines for JSON string values
            return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
          });

          generatedCard = templateStr;
          let cardJson;
          try {
            cardJson = JSON.parse(generatedCard);
          } catch (e) {
            // If template replacement resulted in invalid JSON (e.g. unescaped quotes), try to fix or fail
            console.error('Invalid JSON generated from template', e);
            throw new Error('Generated card is not valid JSON');
          }
          
          let outboundPayload;
          if (Array.isArray(cardJson)) {
            outboundPayload = { attachments: cardJson };
          } else if (cardJson.attachments) {
            outboundPayload = cardJson;
          } else {
            outboundPayload = { attachments: [cardJson] };
          }

          // Send to RingCentral
          const rcResponse = await fetch(notifier.glip_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(outboundPayload)
          });
          
          outboundResponse = await rcResponse.text();
          
          if (!rcResponse.ok) {
            status = 'error';
          }

        } catch (e: any) {
          console.error('Error processing HubSpot event for notifier', notifier.id, e);
          status = 'error';
          outboundResponse = e.message;
        }

        // Log
        await db.run(`
          INSERT INTO logs (id, notifier_id, status, inbound_request, generated_card, outbound_request, outbound_response)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          notifier.id,
          status,
          JSON.stringify(enrichedEvent),
          generatedCard,
          'HubSpot Webhook Auto-Forward',
          outboundResponse
        ]);
      }
    }

    res.status(200).send('Processed');

  } catch (error) {
    console.error('Error processing HubSpot webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/api/auth/clio/url', (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/clio/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIO_CLIENT_ID,
    redirect_uri: redirectUri,
    state: userId, // Passing userId as state for simplicity
  });
  res.json({ url: `${CLIO_AUTH_URL}?${params.toString()}` });
});

app.get('/api/auth/clio/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/clio/callback`;

  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
          <h2 style="color: #ef4444;">Clio Authentication Error</h2>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${error_description || 'No description provided.'}</p>
          <p style="margin-top: 2rem; color: #6b7280;">You can close this window and try again.</p>
        </body>
      </html>
    `);
  }

  try {
    const tokenResponse = await fetch(CLIO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: CLIO_CLIENT_ID,
        client_secret: CLIO_CLIENT_SECRET,
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || 'Failed to get Clio token');
    }

    // We need to know WHICH user initiated this. 
    // Since this is a popup, we can't easily pass state back to the parent window securely via the callback URL 
    // without storing it in a session or cookie.
    // However, the parent window is listening for a postMessage.
    // We can just send the token data back to the parent, and let the parent (which knows the user ID)
    // call an API to store it. 
    // OR, better: The parent window opened the popup. The parent window has the user ID.
    // But the callback happens on the server.
    // The server needs to know the user ID to store the token.
    // We can pass the user ID in the 'state' parameter of the OAuth flow.
    
    // Let's assume we pass userId in state for now.
    // Wait, I didn't implement state passing in the /url endpoint above fully.
    // Let's update the /url endpoint to accept userId query param and pass it in state.
    
    // Actually, for simplicity in this "v1", let's just send a success message to the window opener.
    // The window opener (the React app) will receive the message.
    // BUT, we need to store the token in the DB associated with the user.
    // So we MUST know the user ID here.
    
    // Let's rely on the 'state' param.
    const state = req.query.state as string;
    if (!state) {
        throw new Error('Missing state parameter');
    }
    const userId = state; // Simple state for now

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    await db.run(`
      INSERT INTO service_connections (id, user_id, provider, access_token, refresh_token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `, [
      uuidv4(),
      userId,
      'clio',
      tokenData.access_token,
      tokenData.refresh_token,
      expiresAt
    ]);

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'CLIO_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Clio authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);

  } catch (error: any) {
    console.error('Clio OAuth error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/api/auth/url', (req, res) => {
  console.log('[GET /api/auth/url] Hit!');
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/callback`;
  
  if (!RC_CLIENT_ID) {
    console.error('[GET /api/auth/url] RC_CLIENT_ID is missing!');
    return res.status(500).json({ error: 'Server misconfiguration: Missing RC_CLIENT_ID' });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: RC_CLIENT_ID,
    redirect_uri: redirectUri,
    state: crypto.randomBytes(16).toString('hex'),
  });
  const authUrl = `${RC_SERVER_URL}/restapi/oauth/authorize?${params.toString()}`;
  console.log('[GET /api/auth/url] Returning URL:', authUrl);
  res.json({ url: authUrl });
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
          <h2 style="color: #ef4444;">Authentication Error</h2>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${error_description || 'No description provided.'}</p>
          <p style="margin-top: 2rem; color: #6b7280;">You can close this window and try again.</p>
        </body>
      </html>
    `);
  }

  try {
    const tokenResponse = await fetch(`${RC_SERVER_URL}/restapi/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || 'Failed to get token');
    }

    let user: any = await db.get('SELECT id FROM users WHERE ringcentral_id = ?', [tokenData.owner_id]);
    let actualUserId;
    
    if (user) {
      actualUserId = user.id;
      await db.run('UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?', [
        tokenData.access_token, 
        tokenData.refresh_token, 
        actualUserId
      ]);
    } else {
      actualUserId = uuidv4();
      await db.run('INSERT INTO users (id, ringcentral_id, access_token, refresh_token) VALUES (?, ?, ?, ?)', [
        actualUserId, 
        tokenData.owner_id, 
        tokenData.access_token, 
        tokenData.refresh_token
      ]);
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', userId: '${actualUserId}' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/api/config', (req, res) => {
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  // Construct public URL by replacing 'ais-dev' with 'ais-pre' if present
  // This ensures webhooks use the public, unauthenticated endpoint
  const publicUrl = appUrl.replace('ais-dev', 'ais-pre');
  
  res.json({
    appUrl,
    publicUrl
  });
});

// Notifiers API
class UserNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

async function rcFetch(url: string, options: any, userId: string) {
  let user: any = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new UserNotFoundError('User not found');

  let res = await fetch(`${RC_SERVER_URL}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${user.access_token}`
    }
  });

  if (res.status === 401) {
    // Try refresh
    const tokenResponse = await fetch(`${RC_SERVER_URL}/restapi/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: user.refresh_token,
      })
    });
    
    if (tokenResponse.ok) {
      const tokenData = await tokenResponse.json();
      await db.run('UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?', [
        tokenData.access_token,
        tokenData.refresh_token,
        userId
      ]);
      
      // Retry
      res = await fetch(`${RC_SERVER_URL}${url}`, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${tokenData.access_token}`
        }
      });
    }
  }
  return res;
}

app.get('/api/ringcentral/teams', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Validate user exists
    const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const cachedTeams = await db.query('SELECT * FROM teams WHERE user_id = ?', [userId]);
    res.json({ records: cachedTeams.map((t: any) => ({ id: t.id, name: t.name, isPersonal: !!t.is_personal })) });
  } catch (error: any) {
    console.error('Failed to fetch teams from cache:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch teams' });
  }
});

app.get('/api/ringcentral/teams/sync', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Fetch personal chat first
    try {
      const chatRes = await rcFetch('/restapi/v1.0/glip/chats?type=Personal', { method: 'GET' }, userId);
      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (chatData.records && chatData.records.length > 0) {
          const personalChat = chatData.records[0];
          personalChat.name = 'Personal Chat';
          personalChat.isPersonal = true;
          
          await db.run(`
            INSERT INTO teams (id, user_id, name, is_personal, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              is_personal = excluded.is_personal,
              updated_at = CURRENT_TIMESTAMP
          `, [personalChat.id, userId, personalChat.name, 1]);
          sendEvent('teams', [personalChat]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch personal chat', e);
    }

    let pageToken = '';
    let hasMore = true;
    
    // Fetch all pages
    while (hasMore) {
      const query = new URLSearchParams({ recordCount: '250' });
      if (pageToken) query.append('pageToken', pageToken);
      
      const rcRes = await rcFetch(`/restapi/v1.0/glip/teams?${query.toString()}`, { method: 'GET' }, userId);
      if (!rcRes.ok) {
        const text = await rcRes.text();
        sendEvent('error', { message: text });
        break;
      }
      
      const data = await rcRes.json();
      if (data.records && Array.isArray(data.records)) {
        // Use transaction for batch insert
        await db.transaction(async (tx) => {
          for (const team of data.records) {
             await tx.run(`
              INSERT INTO teams (id, user_id, name, is_personal, updated_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                is_personal = excluded.is_personal,
                updated_at = CURRENT_TIMESTAMP
            `, [team.id, userId, team.name || 'Unnamed Conversation', 0]);
          }
        });
        
        sendEvent('teams', data.records.map((t: any) => ({ id: t.id, name: t.name, isPersonal: false })));
      }
      
      if (data.navigation && data.navigation.nextPageToken) {
        pageToken = data.navigation.nextPageToken;
      } else {
        hasMore = false;
      }
    }
    
    sendEvent('done', { success: true });
  } catch (error: any) {
    console.error('Failed to sync teams:', error);
    if (error instanceof UserNotFoundError) {
      sendEvent('error', { message: 'User not found', code: 'USER_NOT_FOUND' });
    } else {
      sendEvent('error', { message: error.message || 'Failed to sync teams' });
    }
  } finally {
    res.end();
  }
});

app.post('/api/ringcentral/webhooks', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  console.log(`[POST /api/ringcentral/webhooks] Request received from user: ${userId}`);

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { groupId, isPersonal } = req.body;
  console.log(`[POST /api/ringcentral/webhooks] Creating webhook for group: ${groupId}`);

  if (!groupId) return res.status(400).json({ error: 'groupId is required' });

  try {
    const endpoint = `/team-messaging/v1/groups/${groupId}/webhooks`;
    const rcRes = await rcFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId })
    }, userId);

    console.log(`[POST /api/ringcentral/webhooks] RC Response status: ${rcRes.status}`);

    if (!rcRes.ok) {
      const text = await rcRes.text();
      console.error(`[POST /api/ringcentral/webhooks] RC Error: ${text}`);
      return res.status(rcRes.status).json({ error: text });
    }
    const data = await rcRes.json();
    console.log(`[POST /api/ringcentral/webhooks] Webhook created successfully`);
    res.json(data);
  } catch (error: any) {
    console.error('[POST /api/ringcentral/webhooks] Failed to create webhook:', error);
    if (error instanceof UserNotFoundError) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.status(500).json({ error: error.message || 'Failed to create webhook' });
  }
});

app.post('/api/clio/webhook', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { notifierId } = req.body;
  if (!notifierId) return res.status(400).json({ error: 'notifierId is required' });

  try {
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const webhookUrl = `${appUrl}/api/webhook/${notifierId}`;

    // Fetch the notifier to get the selected model and events
    const notifier = await db.get('SELECT * FROM notifiers WHERE id = ?', [notifierId]);
    if (!notifier) return res.status(404).json({ error: 'Notifier not found' });

    const model = notifier.clio_model || 'matter';
    const events = notifier.clio_events ? notifier.clio_events.split(',') : ['created', 'updated'];

    // Create webhook in Clio
    const response = await clioFetch('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          url: webhookUrl,
          fields: "id,display_number,description,status,client", 
          model: model,
          events: events
        }
      })
    }, userId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create Clio webhook: ${text}`);
    }

    const data = await response.json();

    // Save the Clio webhook ID
    if (data.data && data.data.id) {
      await db.run('UPDATE notifiers SET clio_webhook_id = ? WHERE id = ?', [data.data.id, notifierId]);
    }

    res.json(data);
  } catch (error: any) {
    console.error('Failed to create Clio webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notifiers', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Validate user exists
    const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const notifiers = await db.query('SELECT * FROM notifiers WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.json(notifiers);
  } catch (error: any) {
    console.error('Failed to fetch notifiers:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch notifiers' });
  }
});

app.post('/api/notifiers', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id: providedId, name, glip_webhook_url, sample_payload, adaptive_card_template, team_name, filter_variable, filter_operator, filter_value, provider, clio_model, clio_events } = req.body;
  const id = providedId || uuidv4();
  const notification_url = `${process.env.APP_URL}/api/webhook/${id}`;

  try {
    const clioEventsStr = Array.isArray(clio_events) ? clio_events.join(',') : (clio_events || null);

    await db.run(`
      INSERT INTO notifiers (id, user_id, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name, filter_variable, filter_operator, filter_value, provider, clio_model, clio_events)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        glip_webhook_url = excluded.glip_webhook_url,
        sample_payload = excluded.sample_payload,
        adaptive_card_template = excluded.adaptive_card_template,
        team_name = excluded.team_name,
        filter_variable = excluded.filter_variable,
        filter_operator = excluded.filter_operator,
        filter_value = excluded.filter_value,
        provider = excluded.provider,
        clio_model = excluded.clio_model,
        clio_events = excluded.clio_events
    `, [id, userId, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name || null, filter_variable || null, filter_operator || null, filter_value || null, provider || 'custom', clio_model || null, clioEventsStr]);
    
    // Clean up any temporary webhook events for this ID
    await db.run('DELETE FROM webhook_events WHERE public_id = ?', [id]);

    const notifier = await db.get('SELECT * FROM notifiers WHERE id = ?', [id]);
    res.json(notifier);
  } catch (error: any) {
    console.error('Failed to create notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to create notifier' });
  }
});

app.put('/api/notifiers/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, glip_webhook_url, sample_payload, adaptive_card_template, team_name, filter_variable, filter_operator, filter_value, clio_model, clio_events } = req.body;
  const { id } = req.params;

  try {
    // Fetch existing notifier to check for Clio webhook
    const existingNotifier = await db.get('SELECT * FROM notifiers WHERE id = ? AND user_id = ?', [id, userId]);
    if (!existingNotifier) return res.status(404).json({ error: 'Notifier not found' });

    const clioEventsStr = Array.isArray(clio_events) ? clio_events.join(',') : (clio_events || null);

    // Update Clio webhook if needed
    if (existingNotifier.clio_webhook_id) {
      const modelChanged = clio_model && clio_model !== existingNotifier.clio_model;
      const eventsChanged = clioEventsStr && clioEventsStr !== existingNotifier.clio_events;

      if (modelChanged || eventsChanged) {
        try {
          console.log(`Updating Clio webhook ${existingNotifier.clio_webhook_id} for notifier ${id}`);
          const webhookBody = {
            data: {
              model: clio_model || existingNotifier.clio_model,
              events: Array.isArray(clio_events) ? clio_events : (clio_events ? clio_events.split(',') : existingNotifier.clio_events.split(',')),
              url: existingNotifier.notification_url 
            }
          };
          
          await clioFetch(`/webhooks/${existingNotifier.clio_webhook_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookBody)
          }, userId as string);
        } catch (e) {
          console.error('Failed to update Clio webhook:', e);
        }
      }
    }

    await db.run(`
      UPDATE notifiers 
      SET name = ?, glip_webhook_url = ?, sample_payload = ?, adaptive_card_template = ?, team_name = ?, filter_variable = ?, filter_operator = ?, filter_value = ?, clio_model = ?, clio_events = ?
      WHERE id = ? AND user_id = ?
    `, [name, glip_webhook_url, sample_payload, adaptive_card_template, team_name || null, filter_variable || null, filter_operator || null, filter_value || null, clio_model || null, clioEventsStr, id, userId]);
    
    const notifier = await db.get('SELECT * FROM notifiers WHERE id = ?', [id]);
    res.json(notifier);
  } catch (error: any) {
    console.error('Failed to update notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to update notifier' });
  }
});

app.delete('/api/notifiers/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  try {
    const notifier = await db.get('SELECT * FROM notifiers WHERE id = ? AND user_id = ?', [id, userId]);
    if (!notifier) return res.status(404).json({ error: 'Notifier not found' });

    if (notifier.clio_webhook_id) {
      try {
        console.log(`Deleting Clio webhook ${notifier.clio_webhook_id} for notifier ${id}`);
        await clioFetch(`/webhooks/${notifier.clio_webhook_id}`, { method: 'DELETE' }, userId as string);
      } catch (e) {
        console.error('Failed to delete Clio webhook:', e);
      }
    }

    await db.run('DELETE FROM logs WHERE notifier_id = ?', [id]);
    await db.run('DELETE FROM notifiers WHERE id = ? AND user_id = ?', [id, userId]);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to delete notifier' });
  }
});

// Logs API
app.get('/api/logs', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const logs = await db.query(`
      SELECT logs.*, notifiers.name as notifier_name 
      FROM logs 
      JOIN notifiers ON logs.notifier_id = notifiers.id 
      WHERE notifiers.user_id = ? 
      ORDER BY logs.created_at DESC 
      LIMIT 100
    `, [userId]);
    
    res.json(logs);
  } catch (error: any) {
    console.error('Failed to fetch logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch logs' });
  }
});

app.get('/api/notifiers/:id/logs', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  
  try {
    // Verify ownership
    const notifier = await db.get('SELECT id FROM notifiers WHERE id = ? AND user_id = ?', [id, userId]);
    if (!notifier) return res.status(404).json({ error: 'Notifier not found' });

    const logs = await db.query('SELECT * FROM logs WHERE notifier_id = ? ORDER BY created_at DESC LIMIT 50', [id]);
    res.json(logs);
  } catch (error: any) {
    console.error('Failed to fetch notifier logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch notifier logs' });
  }
});

// AI Magic - Generate Adaptive Card
app.post('/api/generate-card', async (req, res) => {
  const { sample_payload } = req.body;
  
  if (!sample_payload) {
    return res.status(400).json({ error: 'Sample payload is required' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
You are an expert at creating Microsoft Adaptive Cards for RingCentral Team Messaging.
Your goal is to create a TEMPLATE, not a static card.

CRITICAL INSTRUCTION:
1. Strictly use Adaptive Cards schema version 1.2. Do not use features from newer versions.
2. You MUST replace specific values from the sample payload with their corresponding {{variable}} tokens.
3. Do NOT hardcode values from the sample payload into the card.

Example:
If the payload is: {"ticket": {"title": "Server Down", "id": 123}}
You MUST generate:
{
  "type": "AdaptiveCard",
  "version": "1.2",
  "body": [
    { "type": "TextBlock", "text": "Ticket: {{ticket.title}}" },
    { "type": "FactSet", "facts": [{ "title": "ID", "value": "{{ticket.id}}" }] }
  ]
}

Sample Payload to tokenize:
${sample_payload}

Return ONLY the raw JSON for the Adaptive Card. Do not include markdown formatting like \`\`\`json.
Make it look professional, with a title, some facts, and maybe a description.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    let jsonStr = response.text?.trim() || '{}';
    if (jsonStr.startsWith('\`\`\`json')) {
      jsonStr = jsonStr.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
    } else if (jsonStr.startsWith('\`\`\`')) {
      jsonStr = jsonStr.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
    }

    res.json({ template: jsonStr });
  } catch (error: any) {
    console.error('AI generation error:', error);
    res.status(500).json({ error: 'Failed to generate card' });
  }
});

// Webhook Discovery API
app.get('/api/webhooks/:id/events', async (req, res) => {
  const { id } = req.params;
  try {
    const events = await db.query('SELECT * FROM webhook_events WHERE public_id = ? ORDER BY created_at DESC LIMIT 10', [id]);
    res.json(events);
  } catch (error: any) {
    console.error('Failed to fetch webhook events:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch webhook events' });
  }
});

// Webhook Processor
app.post('/api/webhook/:notifierId', async (req, res) => {
  const { notifierId } = req.params;
  const inboundPayload = req.body;
  const isTest = req.query.test === 'true' ? 1 : 0;
  const traceId = uuidv4();
  
  console.log(`[Webhook ${traceId}] Processing for notifier: ${notifierId}`);

  const notifier: any = await db.get('SELECT * FROM notifiers WHERE id = ?', [notifierId]);
  
  if (!notifier) {
    // Store as a temporary event for discovery
    try {
      const eventId = uuidv4();
      await db.run('INSERT INTO webhook_events (id, public_id, payload) VALUES (?, ?, ?)', [
        eventId,
        notifierId,
        JSON.stringify(inboundPayload)
      ]);
      
      // Keep only last 10 events for this ID
      const events = await db.query('SELECT id FROM webhook_events WHERE public_id = ? ORDER BY created_at DESC', [notifierId]);
      if (events.length > 10) {
        const idsToDelete = events.slice(10).map((e: any) => e.id);
        if (idsToDelete.length > 0) {
          // Construct placeholders for IN clause
          const placeholders = idsToDelete.map((_, i) => `$${i + 1}`).join(',');
          await db.run(`DELETE FROM webhook_events WHERE id IN (${placeholders})`, idsToDelete);
        }
      }
      
      console.log(`[Webhook ${traceId}] Stored for discovery. Notifier not found.`);
      return res.status(202).json({ 
        status: 'accepted',
        message: 'Event received and stored for discovery',
        traceId,
        discovery: true
      });
    } catch (error: any) {
      console.error(`[Webhook ${traceId}] Failed to store webhook event:`, error);
      return res.status(500).json({ 
        status: 'error',
        error: 'Failed to process webhook',
        traceId
      });
    }
  }

  let generatedCard = '';
  let outboundResponse = '';
  let status = 'success';

  try {
    // Check filter condition
    if (notifier.filter_variable && notifier.filter_operator && notifier.filter_value) {
      const keys = notifier.filter_variable.split('.');
      let value: any = inboundPayload;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          value = undefined;
          break;
        }
      }
      
      const filterValue = notifier.filter_value;
      let isMatch = false;
      
      // Basic type coercion for comparison
      const compareValue = String(value);
      
      switch (notifier.filter_operator) {
        case 'equals':
          isMatch = compareValue === filterValue;
          break;
        case 'not_equals':
          isMatch = compareValue !== filterValue;
          break;
        case 'contains':
          isMatch = compareValue.includes(filterValue);
          break;
        case 'not_contains':
          isMatch = !compareValue.includes(filterValue);
          break;
        case 'starts_with':
          isMatch = compareValue.startsWith(filterValue);
          break;
        case 'ends_with':
          isMatch = compareValue.endsWith(filterValue);
          break;
        case 'greater_than':
          isMatch = Number(value) > Number(filterValue);
          break;
        case 'less_than':
          isMatch = Number(value) < Number(filterValue);
          break;
      }
      
      if (isMatch) {
        console.log(`[Webhook ${traceId}] Filter matched. Skipping notification.`);
        
        // Log the filtered event
        const logId = uuidv4();
        await db.run(`
          INSERT INTO logs (id, notifier_id, status, inbound_request, generated_card, outbound_request, outbound_response, is_test)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          logId, 
          notifierId, 
          'filtered', 
          JSON.stringify({ headers: req.headers, body: inboundPayload, traceId }), 
          '', 
          '',
          `Filtered by rule: ${notifier.filter_variable} ${notifier.filter_operator} ${notifier.filter_value}`,
          isTest
        ]);
        
        return res.status(200).json({
          status: 'filtered',
          message: 'Event filtered by rule',
          traceId
        });
      }
    }

    // Simple template injection replacing {{key.subkey}} with values from inboundPayload
    let templateStr = notifier.adaptive_card_template;
    
    // Replace tokens
    templateStr = templateStr.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (match: string, path: string) => {
      const keys = path.split('.');
      let value: any = inboundPayload;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return match; // Keep original if not found
        }
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });

    generatedCard = templateStr;
    const cardJson = JSON.parse(generatedCard);

    let outboundPayload;
    if (Array.isArray(cardJson)) {
      outboundPayload = { attachments: cardJson };
    } else if (cardJson.attachments) {
      outboundPayload = cardJson;
    } else {
      outboundPayload = { attachments: [cardJson] };
    }

    const requestHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const outboundRequestData = {
      url: notifier.glip_webhook_url,
      method: 'POST',
      headers: requestHeaders,
      body: outboundPayload
    };

    // Post to RingCentral Glip Webhook
    console.log(`[Webhook ${traceId}] Sending to RingCentral: ${notifier.glip_webhook_url}`);
    const rcResponse = await fetch(notifier.glip_webhook_url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(outboundPayload)
    });

    outboundResponse = await rcResponse.text();
    console.log(`[Webhook ${traceId}] RC Response status: ${rcResponse.status}`);
    
    if (!rcResponse.ok) {
      status = 'error';
    } else {
      try {
        const rcJson = JSON.parse(outboundResponse);
        if (rcJson.status === 'Error' || rcJson.status === 'error' || rcJson.error) {
          status = 'error';
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }

    // Return 202 Accepted with traceId
    res.status(202).json({
      status: 'accepted',
      message: 'Event processed',
      traceId,
      rcStatus: rcResponse.status
    });

  } catch (error: any) {
    status = 'error';
    outboundResponse = error.message;
    console.error(`[Webhook ${traceId}] Processing error:`, error);
    
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      traceId
    });
  } finally {
    // Log the activity
    const logId = uuidv4(); 
    
    let outboundRequestStr = '';
    try {
      // Reconstruct outbound request string if possible
      let payload = generatedCard;
      try {
        const parsed = JSON.parse(generatedCard);
        if (Array.isArray(parsed)) {
          payload = JSON.stringify({ attachments: parsed });
        } else if (parsed.attachments) {
          payload = JSON.stringify(parsed);
        } else {
          payload = JSON.stringify({ attachments: [parsed] });
        }
      } catch (e) {}
      
      outboundRequestStr = JSON.stringify({
        url: notifier.glip_webhook_url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.parse(payload || '{}')
      });
    } catch(e) {}

    await db.run(`
      INSERT INTO logs (id, notifier_id, status, inbound_request, generated_card, outbound_request, outbound_response, is_test)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      logId, 
      notifierId, 
      status, 
      JSON.stringify({ headers: req.headers, body: inboundPayload, traceId }), 
      generatedCard, 
      outboundRequestStr,
      outboundResponse,
      isTest
    ]);
    console.log(`[Webhook ${traceId}] Logged activity: ${logId}`);
  }
});

app.get('/public-test', (req, res) => {
  res.send('Public access working!');
});

app.get('/api/webhook/:notifierId', (req, res) => {
  console.log(`[GET /api/webhook/${req.params.notifierId}] Method Not Allowed (likely redirect from POST)`);
  res.status(405).send('Method Not Allowed. Please use POST.');
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Catch-all for API routes to prevent falling through to Vite
app.all('/api/*', (req, res) => {
  console.log(`[API 404] ${req.method} ${req.url}`);
  res.status(404).json({ error: 'API route not found' });
});

async function startServer() {
  console.log(`[Startup] APP_URL: ${process.env.APP_URL}`);
  
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Routes registered:`);
    app._router.stack.forEach((r: any) => {
      if (r.route && r.route.path) {
        console.log(`${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
      }
    });
  });
}

startServer();
