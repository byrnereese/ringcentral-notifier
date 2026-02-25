import express from 'express';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

const app = express();
const PORT = 3000;

app.use(express.json());

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

// Notifiers API
async function rcFetch(url: string, options: any, userId: string) {
  let user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

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
    sendEvent('error', { message: error.message || 'Failed to sync teams' });
  } finally {
    res.end();
  }
});

app.post('/api/ringcentral/webhooks', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { groupId, isPersonal } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId is required' });

  try {
    const endpoint = `/team-messaging/v1/groups/${groupId}/webhooks`;
    const rcRes = await rcFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId })
    }, userId);

    if (!rcRes.ok) {
      const text = await rcRes.text();
      return res.status(rcRes.status).json({ error: text });
    }
    const data = await rcRes.json();
    res.json(data);
  } catch (error: any) {
    console.error('Failed to create webhook:', error);
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

  const { name, glip_webhook_url, sample_payload, adaptive_card_template, team_name } = req.body;
  const id = uuidv4();
  const notification_url = `${process.env.APP_URL}/api/webhook/${id}`;

  try {
    const stmt = db.prepare(`
      INSERT INTO notifiers (id, user_id, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, userId, name, glip_webhook_url, sample_payload, adaptive_card_template, notification_url, team_name || null);
    
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

// Webhook Processor
app.post('/api/webhook/:notifierId', async (req, res) => {
  const { notifierId } = req.params;
  const inboundPayload = req.body;
  const isTest = req.query.test === 'true' ? 1 : 0;
  
  const notifier: any = db.prepare('SELECT * FROM notifiers WHERE id = ?').get(notifierId);
  
  if (!notifier) {
    return res.status(404).json({ error: 'Notifier not found' });
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
    const rcResponse = await fetch(notifier.glip_webhook_url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(outboundPayload)
    });

    outboundResponse = await rcResponse.text();
    
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

    if (isTest) {
      res.status(rcResponse.status).json({
        response: outboundResponse,
        request: outboundRequestData
      });
    } else {
      res.status(rcResponse.status).send(outboundResponse);
    }
  } catch (error: any) {
    status = 'error';
    outboundResponse = error.message;
    if (isTest) {
      res.status(500).json({ error: error.message, response: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
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

    db.prepare(`
      INSERT INTO logs (id, notifier_id, status, inbound_request, generated_card, outbound_request, outbound_response, is_test)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId, 
      notifierId, 
      status, 
      JSON.stringify({ headers: req.headers, body: inboundPayload }), 
      generatedCard, 
      outboundRequestStr,
      outboundResponse,
      isTest
    );
  }
});

async function startServer() {
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
  });
}

startServer();
