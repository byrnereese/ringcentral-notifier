import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Wand2, Save, ArrowLeft, Code, MessageSquare, X, Loader2, Search, Link as LinkIcon, User } from 'lucide-react';

export default function NotifierForm({ userId }: { userId: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;

  const [formData, setFormData] = useState({
    name: '',
    glip_webhook_url: '',
    sample_payload: '{\n  "event": "ticket_created",\n  "ticket": {\n    "id": "12345",\n    "title": "Server down",\n    "status": "open"\n  }\n}',
    adaptive_card_template: '',
    team_name: ''
  });

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [syncingTeams, setSyncingTeams] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualWebhookUrl, setManualWebhookUrl] = useState('');

  useEffect(() => {
    if (isEditing) {
      fetchConnector();
    }
  }, [id]);

  const fetchConnector = async () => {
    try {
      const res = await fetch('/api/notifiers', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      const connector = data.find((c: any) => c.id === id);
      if (connector) {
        setFormData({
          name: connector.name,
          glip_webhook_url: connector.glip_webhook_url,
          sample_payload: connector.sample_payload || '',
          adaptive_card_template: connector.adaptive_card_template || '',
          team_name: connector.team_name || ''
        });
      }
    } catch (error) {
      console.error('Failed to fetch connector', error);
    }
  };

  const fetchTeams = async (forceSync = false) => {
    setLoadingTeams(true);
    try {
      const res = await fetch('/api/ringcentral/teams', {
        headers: { 'x-user-id': userId }
      });
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

    eventSource.addEventListener('error', (e) => {
      console.error('SSE Error', e);
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
      
      if (res.ok) {
        const data = await res.json();
        setFormData(prev => ({
          ...prev,
          glip_webhook_url: data.uri,
          team_name: team.name || 'Unnamed Team'
        }));
        setShowTeamModal(false);
      } else {
        const err = await res.json();
        alert(`Failed to create webhook: ${err.error || 'Unknown error'}`);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = isEditing ? `/api/notifiers/${id}` : '/api/connectors';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        navigate('/dashboard');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to save connector');
      }
    } catch (error) {
      console.error('Save failed', error);
      alert('Failed to save connector');
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
          {isEditing ? 'Edit Connector' : 'New Connector'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-4">Basic Settings</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Connector Name</label>
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
            </div>
            <p className="text-sm text-slate-500">
              Paste a sample JSON payload from your source application. This helps the AI generate a matching Adaptive Card.
            </p>
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
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={loading || !formData.glip_webhook_url}
            className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-70 shadow-sm"
          >
            <Save className="w-5 h-5" />
            {loading ? 'Saving...' : 'Save Connector'}
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
    </div>
  );
}
