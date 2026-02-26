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

const RC_CLIENT_ID = process.env.RC_CLIENT_ID || 'Z1WS9p45Ce0fy8NFEMRuIF';
const RC_CLIENT_SECRET = process.env.RC_CLIENT_SECRET || '1BKY2vlFIFNcAPeZFkOSjffda1MpcrIjmfdF4DizVFhX';
const RC_SERVER_URL = process.env.RC_SERVER_URL || 'https://platform.ringcentral.com';

app.get('/api/auth/url', (req, res) => {
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: RC_CLIENT_ID,
    redirect_uri: redirectUri,
    state: crypto.randomBytes(16).toString('hex'),
  });
  res.json({ url: `${RC_SERVER_URL}/restapi/oauth/authorize?${params.toString()}` });
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;

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

    let user: any = db.prepare('SELECT id FROM users WHERE ringcentral_id = ?').get(tokenData.owner_id);
    let actualUserId;
    
    if (user) {
      actualUserId = user.id;
      db.prepare('UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?').run(
        tokenData.access_token, 
        tokenData.refresh_token, 
        actualUserId
      );
    } else {
      actualUserId = uuidv4();
      db.prepare('INSERT INTO users (id, ringcentral_id, access_token, refresh_token) VALUES (?, ?, ?, ?)').run(
        actualUserId, 
        tokenData.owner_id, 
        tokenData.access_token, 
        tokenData.refresh_token
      );
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
  let user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
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
      db.prepare('UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?').run(
        tokenData.access_token,
        tokenData.refresh_token,
        userId
      );
      
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
    const cachedTeams = db.prepare('SELECT * FROM teams WHERE user_id = ?').all(userId);
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
    const insertTeam = db.prepare(`
      INSERT INTO teams (id, user_id, name, is_personal, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        is_personal = excluded.is_personal,
        updated_at = CURRENT_TIMESTAMP
    `);

    // Fetch personal chat first
    try {
      const chatRes = await rcFetch('/restapi/v1.0/glip/chats?type=Personal', { method: 'GET' }, userId);
      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (chatData.records && chatData.records.length > 0) {
          const personalChat = chatData.records[0];
          personalChat.name = 'Personal Chat';
          personalChat.isPersonal = true;
          
          insertTeam.run(personalChat.id, userId, personalChat.name, 1);
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
        const dbTransaction = db.transaction((teams: any[]) => {
          for (const team of teams) {
            insertTeam.run(team.id, userId, team.name || 'Unnamed Conversation', 0);
          }
        });
        dbTransaction(data.records);
        
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

app.get('/api/notifiers', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const notifiers = db.prepare('SELECT * FROM notifiers WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    res.json(notifiers);
  } catch (error: any) {
    console.error('Failed to fetch notifiers:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch notifiers' });
  }
});

app.post('/api/notifiers', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id: providedId, name, glip_webhook_url, sample_payload, adaptive_card_template, team_name } = req.body;
  const id = providedId || uuidv4();
  const notification_url = `${process.env.APP_URL}/api/webhook/${id}`;

  try {
    const stmt = db.prepare(`
      INSERT INTO notifiers (id, user_id, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, userId, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name || null);
    
    // Clean up any temporary webhook events for this ID
    db.prepare('DELETE FROM webhook_events WHERE public_id = ?').run(id);

    const notifier = db.prepare('SELECT * FROM notifiers WHERE id = ?').get(id);
    res.json(notifier);
  } catch (error: any) {
    console.error('Failed to create notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to create notifier' });
  }
});

app.put('/api/notifiers/:id', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, glip_webhook_url, sample_payload, adaptive_card_template, team_name } = req.body;
  const { id } = req.params;

  try {
    const stmt = db.prepare(`
      UPDATE notifiers 
      SET name = ?, glip_webhook_url = ?, sample_payload = ?, adaptive_card_template = ?, team_name = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(name, glip_webhook_url, sample_payload, adaptive_card_template, team_name || null, id, userId);
    
    const notifier = db.prepare('SELECT * FROM notifiers WHERE id = ?').get(id);
    res.json(notifier);
  } catch (error: any) {
    console.error('Failed to update notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to update notifier' });
  }
});

app.delete('/api/notifiers/:id', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  try {
    db.prepare('DELETE FROM logs WHERE notifier_id = ?').run(id);
    db.prepare('DELETE FROM notifiers WHERE id = ? AND user_id = ?').run(id, userId);
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete notifier:', error);
    res.status(500).json({ error: error.message || 'Failed to delete notifier' });
  }
});

// Logs API
app.get('/api/logs', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const logs = db.prepare(`
      SELECT logs.*, notifiers.name as notifier_name 
      FROM logs 
      JOIN notifiers ON logs.notifier_id = notifiers.id 
      WHERE notifiers.user_id = ? 
      ORDER BY logs.created_at DESC 
      LIMIT 100
    `).all(userId);
    
    res.json(logs);
  } catch (error: any) {
    console.error('Failed to fetch logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch logs' });
  }
});

app.get('/api/notifiers/:id/logs', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  
  try {
    // Verify ownership
    const notifier = db.prepare('SELECT id FROM notifiers WHERE id = ? AND user_id = ?').get(id, userId);
    if (!notifier) return res.status(404).json({ error: 'Notifier not found' });

    const logs = db.prepare('SELECT * FROM logs WHERE notifier_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
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
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
You are an expert at creating Microsoft Adaptive Cards for RingCentral Team Messaging.
Given the following sample JSON payload from an incoming webhook, generate a valid Adaptive Card JSON template.
Use {{key}} syntax to inject values from the payload. For example, if the payload has {"user": {"name": "John"}}, use {{user.name}} in the Adaptive Card.

Sample Payload:
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
app.get('/api/webhooks/:id/events', (req, res) => {
  const { id } = req.params;
  try {
    const events = db.prepare('SELECT * FROM webhook_events WHERE public_id = ? ORDER BY created_at DESC LIMIT 10').all(id);
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

  const notifier: any = db.prepare('SELECT * FROM notifiers WHERE id = ?').get(notifierId);
  
  if (!notifier) {
    // Store as a temporary event for discovery
    try {
      const eventId = uuidv4();
      db.prepare('INSERT INTO webhook_events (id, public_id, payload) VALUES (?, ?, ?)').run(
        eventId,
        notifierId,
        JSON.stringify(inboundPayload)
      );
      
      // Keep only last 10 events for this ID
      const events = db.prepare('SELECT id FROM webhook_events WHERE public_id = ? ORDER BY created_at DESC').all(notifierId);
      if (events.length > 10) {
        const idsToDelete = events.slice(10).map((e: any) => e.id);
        if (idsToDelete.length > 0) {
          const placeholders = idsToDelete.map(() => '?').join(',');
          db.prepare(`DELETE FROM webhook_events WHERE id IN (${placeholders})`).run(...idsToDelete);
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
    const logId = uuidv4(); // Use separate ID for DB log entry, or reuse traceId? Let's use traceId for consistency if possible, but schema uses UUID.
    // Let's use a new UUID for the log entry but store traceId if we had a column. We don't, so just log it.
    
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

    db.prepare(`
      INSERT INTO logs (id, notifier_id, status, inbound_request, generated_card, outbound_request, outbound_response, is_test)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId, 
      notifierId, 
      status, 
      JSON.stringify({ headers: req.headers, body: inboundPayload, traceId }), 
      generatedCard, 
      outboundRequestStr,
      outboundResponse,
      isTest
    );
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
