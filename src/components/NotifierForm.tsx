import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Wand2, Save, ArrowLeft, Code, MessageSquare, X, Loader2, Search, Link as LinkIcon, User, Eye, History, RefreshCw, Copy, Check, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import CardPreview from './CardPreview';

export default function NotifierForm({ userId }: { userId: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  
  // Get provider from URL query params
  const [searchParams] = useSearchParams();
  const provider = searchParams.get('provider') || 'custom';
  
  // Generate a draft ID for new notifiers so we can show the webhook URL immediately
  const [draftId] = useState(() => isEditing ? id : uuidv4());
  const [copied, setCopied] = useState(false);

  const [formData, setFormData] = useState({
    name: provider === 'clio' ? 'Clio Notifier' : '',
    glip_webhook_url: '',
    sample_payload: provider === 'clio' ? JSON.stringify({
      "data": {
        "id": 123456,
        "display_number": "M-00001",
        "description": "Estate Planning for John Doe",
        "status": "Open",
        "client": {
          "id": 789,
          "name": "John Doe"
        }
      },
      "meta": {
        "event": "Matter created",
        "timestamp": "2023-01-01T12:00:00Z"
      }
    }, null, 2) : '{\n  "event": "ticket_created",\n  "ticket": {\n    "id": "12345",\n    "title": "Server down",\n    "status": "open"\n  }\n}',
    adaptive_card_template: '',
    team_name: '',
    filter_variable: '',
    filter_operator: '',
    filter_value: '',
    clio_model: 'matter',
    clio_events: ['created', 'updated']
  });

  const CLIO_MODELS = [
    { value: 'activity', label: 'Activity' },
    { value: 'bill', label: 'Bill' },
    { value: 'calendar_entry', label: 'Calendar Entry' },
    { value: 'clio_payments_payment', label: 'Clio Payment' },
    { value: 'communication', label: 'Communication' },
    { value: 'contact', label: 'Contact' },
    { value: 'document', label: 'Document' },
    { value: 'folder', label: 'Folder' },
    { value: 'matter', label: 'Matter' },
    { value: 'task', label: 'Task' }
  ];

  const CLIO_EVENTS = [
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Updated' },
    { value: 'deleted', label: 'Deleted' },
    { value: 'matter_opened', label: 'Matter Opened' },
    { value: 'matter_pended', label: 'Matter Pended' },
    { value: 'matter_closed', label: 'Matter Closed' }
  ];

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'success' | 'error', message: string, response?: string, request?: string } | null>(null);
  
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [syncingTeams, setSyncingTeams] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualWebhookUrl, setManualWebhookUrl] = useState('');
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);

  // New state for features
  const [showPreview, setShowPreview] = useState(false);
  const [showEventsModal, setShowEventsModal] = useState(false);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [polling, setPolling] = useState(false);
  const [appUrl, setAppUrl] = useState<string>('');
  const [isFilteringExpanded, setIsFilteringExpanded] = useState(false);
  
  // Clio specific state
  const [clioConnected, setClioConnected] = useState(false);
  const [connectingClio, setConnectingClio] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CLIO_AUTH_SUCCESS') {
        setClioConnected(true);
        setConnectingClio(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectClio = async () => {
    setConnectingClio(true);
    try {
      const res = await fetch(`/api/auth/clio/url?userId=${userId}`);
      const data = await res.json();
      
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        data.url,
        'Clio Auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (error) {
      console.error('Failed to get Clio auth URL', error);
      setConnectingClio(false);
      alert('Failed to start Clio connection');
    }
  };

  // Extract variables from payload whenever it changes
  useEffect(() => {
    try {
      if (!formData.sample_payload) {
        setAvailableVariables([]);
        return;
      }
      
      const payload = JSON.parse(formData.sample_payload);
      const vars: string[] = [];
      
      const extractKeys = (obj: any, prefix = '') => {
        if (!obj || typeof obj !== 'object') return;
        
        Object.keys(obj).forEach(key => {
          const path = prefix ? `${prefix}.${key}` : key;
          vars.push(path);
          
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            extractKeys(obj[key], path);
          }
        });
      };
      
      extractKeys(payload);
      setAvailableVariables(vars.sort());
    } catch (e) {
      // Invalid JSON, just clear variables
      setAvailableVariables([]);
    }
  }, [formData.sample_payload]);

  useEffect(() => {
    // Fetch app config to get the correct public URL
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        let url = data.publicUrl || data.appUrl || window.location.origin;
        // Force HTTPS if not localhost
        if (url.startsWith('http:') && !url.includes('localhost')) {
          url = url.replace('http:', 'https:');
        }
        setAppUrl(url);
      })
      .catch(err => {
        console.error('Failed to fetch config', err);
        setAppUrl(window.location.origin);
      });

    if (isEditing) {
      fetchNotifier();
    } else {
      // Start polling for events on the draft ID
      setPolling(true);
    }
  }, [id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (polling && draftId) {
      fetchRecentEvents(true); // Initial fetch
      interval = setInterval(() => fetchRecentEvents(true), 3000);
    }
    return () => clearInterval(interval);
  }, [polling, draftId]);

  const fetchRecentEvents = async (silent = false) => {
    if (!draftId) return;
    if (!silent) setLoadingEvents(true);
    try {
      const res = await fetch(`/api/webhooks/${draftId}/events`);
      if (res.ok) {
        const events = await res.json();
        setRecentEvents(events);
        
        // Auto-populate if we have events and the payload is still the default
        if (events.length > 0 && !isEditing) {
          const defaultPayload = '{\n  "event": "ticket_created",\n  "ticket": {\n    "id": "12345",\n    "title": "Server down",\n    "status": "open"\n  }\n}';
          
          // Use a more robust check (e.g. trimming or checking if it includes the default structure)
          // Or simply check if it matches the initial state
          if (formData.sample_payload === defaultPayload || formData.sample_payload.includes('"ticket_created"')) {
            try {
              const latestPayload = JSON.stringify(JSON.parse(events[0].payload), null, 2);
              setFormData(prev => {
                // Only update if it's different to avoid loops/re-renders
                if (prev.sample_payload !== latestPayload) {
                   return { ...prev, sample_payload: latestPayload };
                }
                return prev;
              });
            } catch (e) {
              console.error('Failed to parse event payload', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch events', error);
    } finally {
      if (!silent) setLoadingEvents(false);
    }
  };

  const fetchNotifier = async () => {
    try {
      const res = await fetch('/api/notifiers', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      const notifier = data.find((c: any) => c.id === id);
      if (notifier) {
        setFormData({
          name: notifier.name,
          glip_webhook_url: notifier.glip_webhook_url,
          sample_payload: notifier.sample_payload || '',
          adaptive_card_template: notifier.adaptive_card_template || '',
          team_name: notifier.team_name || '',
          filter_variable: notifier.filter_variable || '',
          filter_operator: notifier.filter_operator || '',
          filter_value: notifier.filter_value || ''
        });
        
        if (notifier.filter_variable || notifier.filter_operator || notifier.filter_value) {
          setIsFilteringExpanded(true);
        }
      }
    } catch (error) {
      console.error('Failed to fetch notifier', error);
    }
  };

  const fetchTeams = async (forceSync = false) => {
    setLoadingTeams(true);
    try {
      const res = await fetch('/api/ringcentral/teams', {
        headers: { 'x-user-id': userId }
      });
      
      if (res.status === 401) {
        localStorage.removeItem('userId');
        window.location.reload();
        return;
      }

      let shouldSync = forceSync || !res.ok;
      if (res.ok) {
        const data = await res.json();
        if (data.records && data.records.length > 0) {
          const sortedTeams = data.records.sort((a: any, b: any) => {
            if (a.isPersonal && !b.isPersonal) return -1;
            if (!a.isPersonal && b.isPersonal) return 1;
            const nameA = a.name || 'Unnamed Conversation';
            const nameB = b.name || 'Unnamed Conversation';
            return nameA.localeCompare(nameB);
          });
          setTeams(sortedTeams);
          setLoadingTeams(false);
        } else {
          shouldSync = true;
        }
      }
      
      if (shouldSync) {
        syncTeams();
      }
    } catch (error) {
      console.error('Failed to fetch teams', error);
      setLoadingTeams(false);
    }
  };

  const syncTeams = () => {
    setSyncingTeams(true);
    const eventSource = new EventSource(`/api/ringcentral/teams/sync?userId=${userId}`);
    
    eventSource.addEventListener('teams', (e) => {
      const newTeams = JSON.parse(e.data);
      setTeams(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const uniqueNewTeams = newTeams.filter((t: any) => !existingIds.has(t.id));
        const combined = [...prev, ...uniqueNewTeams];
        return combined.sort((a: any, b: any) => {
          if (a.isPersonal && !b.isPersonal) return -1;
          if (!a.isPersonal && b.isPersonal) return 1;
          const nameA = a.name || 'Unnamed Conversation';
          const nameB = b.name || 'Unnamed Conversation';
          return nameA.localeCompare(nameB);
        });
      });
      setLoadingTeams(false);
    });

    eventSource.addEventListener('done', () => {
      setSyncingTeams(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', (e: any) => {
      console.error('SSE Error', e);
      if (e.data) {
        try {
          const err = JSON.parse(e.data);
          if (err.code === 'USER_NOT_FOUND' || err.message === 'User not found') {
            localStorage.removeItem('userId');
            window.location.reload();
            return;
          }
        } catch (err) {
          // ignore
        }
      }
      setSyncingTeams(false);
      eventSource.close();
    });
  };

  const handleSelectTeam = async (team: any) => {
    setLoadingTeams(true);
    try {
      const res = await fetch('/api/ringcentral/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ groupId: team.id, isPersonal: team.isPersonal })
      });
      
      if (res.status === 401) {
        localStorage.removeItem('userId');
        window.location.reload();
        return;
      }
      
      if (res.ok) {
        const data = await res.json();
        setFormData(prev => ({
          ...prev,
          glip_webhook_url: data.uri,
          team_name: team.name || 'Unnamed Team'
        }));
        setShowTeamModal(false);
      } else {
        const text = await res.text();
        try {
          const err = JSON.parse(text);
          alert(`Failed to create webhook: ${err.error || 'Unknown error'}`);
        } catch (e) {
          console.error('Server returned non-JSON error:', text);
          alert(`Failed to create webhook: Server returned an error. Check console for details.`);
        }
      }
    } catch (error) {
      console.error('Failed to create webhook', error);
      alert('Failed to create webhook');
    } finally {
      setLoadingTeams(false);
    }
  };

  const handleOpenTeamModal = () => {
    setShowTeamModal(true);
    if (teams.length === 0) {
      fetchTeams();
    }
  };

  const handleManualWebhookSubmit = () => {
    if (!manualWebhookUrl) return;
    setFormData(prev => ({
      ...prev,
      glip_webhook_url: manualWebhookUrl,
      team_name: 'Manual Webhook'
    }));
    setShowTeamModal(false);
    setShowManualInput(false);
    setManualWebhookUrl('');
  };

  const handleGenerate = async () => {
    if (!formData.sample_payload) {
      alert('Please provide a sample payload first.');
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch('/api/generate-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ sample_payload: formData.sample_payload })
      });
      const data = await res.json();
      if (data.template) {
        setFormData(prev => ({ ...prev, adaptive_card_template: data.template }));
      } else {
        alert(data.error || 'Failed to generate template');
      }
    } catch (error) {
      console.error('Generation failed', error);
      alert('Failed to generate template');
    } finally {
      setGenerating(false);
    }
  };

  const handleTest = async () => {
    if (!formData.glip_webhook_url || !formData.sample_payload || !formData.adaptive_card_template) {
      alert('Please fill in all fields before testing.');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // 1. Save the notifier first (upsert)
      const url = isEditing ? `/api/notifiers/${id}` : '/api/notifiers';
      const method = isEditing ? 'PUT' : 'POST';
      
      const payload = {
        ...formData,
        ...(isEditing ? {} : { id: draftId })
      };

      const saveRes = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify(payload)
      });

      if (!saveRes.ok) {
        throw new Error('Failed to save notifier configuration before testing');
      }

      // 2. Send the test webhook
      const targetId = isEditing ? id : draftId;
      // Use the local API route, not the full appUrl to avoid CORS/network issues if appUrl is misconfigured
      const res = await fetch(`/api/webhook/${targetId}?test=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: formData.sample_payload
      });
      
      const text = await res.text();
      let responseData: any = { response: text };
      try {
        responseData = JSON.parse(text);
      } catch (e) {}
      
      let isError = !res.ok;
      if (res.ok && responseData.response) {
        try {
          const rcJson = JSON.parse(responseData.response);
          if (rcJson.status === 'Error' || rcJson.status === 'error' || rcJson.error) {
            isError = true;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!isError) {
        setTestResult({ 
          status: 'success', 
          message: 'Test payload sent successfully!', 
          response: responseData.response,
          request: responseData.request ? JSON.stringify(responseData.request, null, 2) : undefined
        });
      } else {
        setTestResult({ 
          status: 'error', 
          message: 'Test failed', 
          response: responseData.response || text,
          request: responseData.request ? JSON.stringify(responseData.request, null, 2) : undefined
        });
      }

    } catch (error: any) {
      console.error('Test failed', error);
      setTestResult({ status: 'error', message: 'Test failed: ' + error.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = isEditing ? `/api/notifiers/${id}` : '/api/notifiers';
      const method = isEditing ? 'PUT' : 'POST';
      
      const payload = {
        ...formData,
        ...(isEditing ? {} : { id: draftId }) // Send the draft ID if creating new
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const savedNotifier = await res.json();
        
        // If provider is Clio, create the webhook in Clio
        if (provider === 'clio' && !isEditing) {
          try {
            const clioRes = await fetch('/api/clio/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-id': userId
              },
              body: JSON.stringify({ notifierId: savedNotifier.id })
            });
            
            if (!clioRes.ok) {
              const err = await clioRes.json();
              console.error('Failed to create Clio webhook', err);
              alert(`Notifier saved, but failed to create webhook in Clio: ${err.error}`);
            }
          } catch (e) {
            console.error('Failed to create Clio webhook', e);
            alert('Notifier saved, but failed to create webhook in Clio.');
          }
        }

        navigate('/dashboard');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to save notifier');
      }
    } catch (error) {
      console.error('Save failed', error);
      alert('Failed to save notifier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/dashboard')}
          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-2xl font-bold text-slate-900">
          {isEditing ? 'Edit Notifier' : 'New Notifier'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {provider === 'clio' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-4 flex items-center gap-2">
              <img src="https://cdn.worldvectorlogo.com/logos/clio-1.svg" alt="Clio" className="w-6 h-6" onError={(e) => (e.currentTarget.style.display = 'none')} />
              Connect to Clio
            </h3>
            <p className="text-sm text-slate-500">
              Connect your Clio Manage account to automatically receive notifications about Matter updates.
            </p>
            
            <div className="flex items-center gap-4">
              {clioConnected ? (
                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg border border-emerald-200">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Connected to Clio</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectClio}
                  disabled={connectingClio}
                  className="bg-[#005CA5] text-white px-6 py-2.5 rounded-lg font-medium hover:bg-[#004d8a] transition-colors flex items-center gap-2 disabled:opacity-70"
                >
                  {connectingClio ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                  Connect Clio Account
                </button>
              )}
            </div>

            {clioConnected && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Resource to Monitor
                  </label>
                  <select
                    value={formData.clio_model}
                    onChange={(e) => setFormData({ ...formData, clio_model: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  >
                    {CLIO_MODELS.map(model => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Events to Trigger On
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-3 border border-slate-300 rounded-lg bg-slate-50 max-h-40 overflow-y-auto">
                    {CLIO_EVENTS.map(event => (
                      <label key={event.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.clio_events.includes(event.value)}
                          onChange={(e) => {
                            const newEvents = e.target.checked
                              ? [...formData.clio_events, event.value]
                              : formData.clio_events.filter(ev => ev !== event.value);
                            setFormData({ ...formData, clio_events: newEvents });
                          }}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700">{event.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-4">Basic Settings</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Notifier Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="e.g. Jira Tickets to Engineering"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">RingCentral Conversation</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenTeamModal}
                  className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  Select Conversation
                </button>
                {formData.team_name && (
                  <span className="text-sm font-medium text-slate-900 bg-slate-100 px-3 py-1.5 rounded-md border border-slate-200">
                    {formData.team_name}
                  </span>
                )}
              </div>
              {formData.glip_webhook_url && (
                <p className="text-xs text-slate-500 mt-2 truncate max-w-md" title={formData.glip_webhook_url}>
                  Webhook URL: {formData.glip_webhook_url}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Code className="w-5 h-5 text-slate-400" />
                Sample Webhook Payload
              </h3>
              <button
                type="button"
                onClick={() => {
                  fetchRecentEvents();
                  setShowEventsModal(true);
                }}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                <History className="w-3 h-3" />
                Select from Past Events
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Paste a sample JSON payload from your source application. This helps the AI generate a matching Adaptive Card.
            </p>
            
            {!isEditing && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 flex flex-col gap-3">
                <p className="font-semibold">Send a test event to this URL to auto-populate:</p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      readOnly 
                      value={appUrl ? `${appUrl}/api/webhook/${draftId}` : 'Loading...'}
                      className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg font-mono text-xs text-slate-600 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (appUrl) {
                        navigator.clipboard.writeText(`${appUrl}/api/webhook/${draftId}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="p-2 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                {recentEvents.length > 0 && (
                  <div className="flex items-center gap-2 text-emerald-600 font-medium animate-pulse">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                    New events received! Click "Select from Past Events" to use.
                  </div>
                )}
              </div>
            )}

            <textarea
              value={formData.sample_payload}
              onChange={e => setFormData({ ...formData, sample_payload: e.target.value })}
              className="w-full flex-1 min-h-[300px] p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
              placeholder="Paste JSON here..."
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !formData.sample_payload}
              className="w-full flex items-center justify-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-3 rounded-lg font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
            >
              <Wand2 className="w-5 h-5" />
              {generating ? 'Generating Magic...' : 'AI Magic: Generate Adaptive Card'}
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Code className="w-5 h-5 text-slate-400" />
                Adaptive Card Template
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  disabled={!formData.adaptive_card_template}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
                >
                  <Eye className="w-3 h-3" />
                  Preview Card
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Refine the generated Adaptive Card JSON. Use <code>{`{{key.subkey}}`}</code> syntax to inject values from the incoming webhook.
            </p>
            <textarea
              required
              value={formData.adaptive_card_template}
              onChange={e => setFormData({ ...formData, adaptive_card_template: e.target.value })}
              className="w-full flex-1 min-h-[300px] p-4 bg-slate-900 border border-slate-800 rounded-lg font-mono text-sm text-emerald-400 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              placeholder="Adaptive Card JSON template..."
            />
            
            {testResult && (
              <div className={`p-4 rounded-lg border ${testResult.status === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex justify-between items-start">
                  <h4 className={`font-semibold ${testResult.status === 'success' ? 'text-emerald-900' : 'text-red-900'}`}>
                    {testResult.message}
                  </h4>
                  <button 
                    type="button"
                    onClick={() => setTestResult(null)}
                    className={`p-1 rounded hover:bg-black/5 ${testResult.status === 'success' ? 'text-emerald-700' : 'text-red-700'}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 mt-3">
                  {testResult.request && (
                    <div>
                      <h5 className={`text-xs font-semibold uppercase tracking-wider mb-1 ${testResult.status === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>Outbound Request</h5>
                      <pre className={`p-2 rounded text-xs font-mono overflow-auto max-h-48 ${testResult.status === 'success' ? 'bg-emerald-100/50 text-emerald-800 border border-emerald-200' : 'bg-red-100/50 text-red-800 border border-red-200'}`}>
                        {testResult.request}
                      </pre>
                    </div>
                  )}
                  {testResult.response && (
                    <div>
                      <h5 className={`text-xs font-semibold uppercase tracking-wider mb-1 ${testResult.status === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>RingCentral Response</h5>
                      <pre className={`p-2 rounded text-xs font-mono overflow-auto max-h-48 ${testResult.status === 'success' ? 'bg-emerald-100/50 text-emerald-800 border border-emerald-200' : 'bg-red-100/50 text-red-800 border border-red-200'}`}>
                        {testResult.response}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setIsFilteringExpanded(!isFilteringExpanded)}
            className="w-full flex items-center justify-between p-6 bg-white hover:bg-slate-50 transition-colors"
          >
            <div className="flex flex-col items-start gap-1">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                {isFilteringExpanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                Filtering Rules (Optional)
              </h3>
              <p className="text-sm text-slate-500 text-left pl-7">
                Define a condition to filter out events. If the condition matches, the event will NOT be posted to RingCentral.
              </p>
            </div>
          </button>
          
          {isFilteringExpanded && (
            <div className="p-6 pt-0 border-t border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Variable</label>
                  <select
                    value={formData.filter_variable}
                    onChange={e => setFormData({ ...formData, filter_variable: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white"
                  >
                    <option value="">Select variable...</option>
                    {availableVariables.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400">Variables extracted from sample payload</p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Operator</label>
                  <select
                    value={formData.filter_operator}
                    onChange={e => setFormData({ ...formData, filter_operator: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white"
                  >
                    <option value="">Select operator...</option>
                    <option value="equals">Equals</option>
                    <option value="not_equals">Does not equal</option>
                    <option value="contains">Contains</option>
                    <option value="not_contains">Does not contain</option>
                    <option value="starts_with">Starts with</option>
                    <option value="ends_with">Ends with</option>
                    <option value="greater_than">Greater than</option>
                    <option value="less_than">Less than</option>
                  </select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Value</label>
                  <input
                    type="text"
                    value={formData.filter_value}
                    onChange={e => setFormData({ ...formData, filter_value: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="Value to compare against"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !formData.adaptive_card_template || !formData.sample_payload}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-300 px-6 py-3 rounded-lg font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50 shadow-sm"
            title="Save and send a test webhook"
          >
            <Play className="w-5 h-5" />
            {testing ? 'Sending...' : 'Send Test'}
          </button>
          <button
            type="submit"
            disabled={loading || !formData.glip_webhook_url || (provider === 'clio' && !clioConnected)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-70 shadow-sm"
          >
            <Save className="w-5 h-5" />
            {loading ? 'Saving...' : 'Save Notifier'}
          </button>
        </div>
      </form>

      {showTeamModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-600" />
                Select Conversation
              </h3>
              <button 
                onClick={() => {
                  setShowTeamModal(false);
                  setShowManualInput(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {showManualInput ? (
              <div className="p-4 flex flex-col gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Manual Webhook URL</label>
                  <input
                    type="url"
                    value={manualWebhookUrl}
                    onChange={e => setManualWebhookUrl(e.target.value)}
                    placeholder="https://hooks.ringcentral.com/webhook/..."
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => setShowManualInput(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleManualWebhookSubmit}
                    disabled={!manualWebhookUrl}
                    className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    Save URL
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-slate-100 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {syncingTeams && (
                        <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Fetching teams...
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => fetchTeams(true)}
                        disabled={syncingTeams}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                      >
                        Refresh list
                      </button>
                      <button
                        onClick={() => setShowManualInput(true)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                      >
                        <LinkIcon className="w-3 h-3" />
                        Enter webhook URL manually
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 flex-1 overflow-auto">
                  {loadingTeams ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-600" />
                      <p>Loading conversations...</p>
                    </div>
                  ) : teams.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <p>No conversations found.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {teams.filter(t => (t.name || 'Unnamed Conversation').toLowerCase().includes(searchQuery.toLowerCase())).map(team => (
                        <button
                          key={team.id}
                          onClick={() => handleSelectTeam(team)}
                          className={`w-full text-left px-4 py-3 rounded-lg border hover:border-indigo-300 hover:bg-indigo-50 transition-colors flex items-center justify-between group ${team.isPersonal ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200'}`}
                        >
                          <span className="font-medium text-slate-900 group-hover:text-indigo-900 truncate pr-4 flex items-center gap-2">
                            {team.isPersonal && <User className="w-4 h-4 text-indigo-500" />}
                            {team.name || 'Unnamed Conversation'}
                          </span>
                          <span className="text-xs text-slate-400 group-hover:text-indigo-500 whitespace-nowrap">
                            Select
                          </span>
                        </button>
                      ))}
                      {teams.filter(t => (t.name || 'Unnamed Conversation').toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                        <div className="text-center py-8 text-slate-500">
                          <p>No conversations match your search.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Eye className="w-5 h-5 text-indigo-600" />
                Adaptive Card Preview
              </h3>
              <button 
                onClick={() => setShowPreview(false)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-auto bg-slate-50">
              <CardPreview cardJson={formData.adaptive_card_template} />
            </div>
          </div>
        </div>
      )}

      {/* Events Modal */}
      {showEventsModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                Select from Past Events
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchRecentEvents()}
                  disabled={loadingEvents}
                  className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors disabled:opacity-50"
                  title="Refresh events"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingEvents ? 'animate-spin' : ''}`} />
                </button>
                <button 
                  onClick={() => setShowEventsModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-4 flex-1 overflow-auto bg-slate-50">
              {loadingEvents ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-600" />
                  <p>Loading events...</p>
                </div>
              ) : recentEvents.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <p>No events found.</p>
                  <p className="text-sm mt-2">Send a webhook to the URL to see it here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentEvents.map(event => (
                    <div key={event.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:border-indigo-300 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-medium text-slate-500">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                        <button
                          onClick={() => {
                            setFormData(prev => ({ ...prev, sample_payload: JSON.stringify(JSON.parse(event.payload), null, 2) }));
                            setShowEventsModal(false);
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full"
                        >
                          Use Payload
                        </button>
                      </div>
                      <pre className="bg-slate-900 text-slate-300 p-3 rounded text-xs font-mono overflow-auto max-h-32">
                        {JSON.stringify(JSON.parse(event.payload), null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
