import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Settings, Activity, Trash2, Copy, Check, Play, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Notifier {
  id: string;
  name: string;
  notification_url: string;
  created_at: string;
  sample_payload?: string;
}

export default function Dashboard({ userId }: { userId: string }) {
  const [notifiers, setNotifiers] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testConnector, setTestConnector] = useState<Connector | null>(null);
  const [testPayload, setTestPayload] = useState('');
  const [testTemplate, setTestTemplate] = useState('');
  const [testResult, setTestResult] = useState<{ status: 'success' | 'error', message: string, response?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'payload' | 'template'>('payload');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchConnectors();
  }, [userId]);

  const fetchConnectors = async () => {
    try {
      const res = await fetch('/api/notifiers', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      setConnectors(data);
    } catch (error) {
      console.error('Failed to fetch connectors', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this connector?')) return;
    
    try {
      await fetch(`/api/connectors/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId }
      });
      setConnectors(connectors.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to delete connector', error);
    }
  };

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTest = async () => {
    if (!testConnector || !testPayload) return;
    setTesting(true);
    setTestResult(null);
    try {
      // If template changed, update connector first
      if (testTemplate !== (testConnector as any).adaptive_card_template) {
        await fetch(`/api/connectors/${testConnector.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
          body: JSON.stringify({ ...testConnector, adaptive_card_template: testTemplate })
        });
        // Update local connector state
        setConnectors(connectors.map(c => c.id === testConnector.id ? { ...c, adaptive_card_template: testTemplate } : c));
        setTestConnector({ ...testConnector, adaptive_card_template: testTemplate } as any);
      }

      const res = await fetch(`${testConnector.notification_url}?test=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: testPayload
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
      setTestResult({ status: 'error', message: 'Failed to send test payload', response: error.message });
    } finally {
      setTesting(false);
    }
  };

  const openTestModal = (connector: Connector) => {
    setTestConnector(connector);
    setTestPayload(connector.sample_payload || '{\n  "event": "test"\n}');
    setTestTemplate((connector as any).adaptive_card_template || '');
    setTestResult(null);
    setActiveTab('payload');
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading connectors...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Your Connectors</h2>
        <Link 
          to="/connectors/new" 
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Connector
        </Link>
      </div>

      {connectors.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No connectors yet</h3>
          <p className="text-slate-500 mb-6 max-w-sm mx-auto">
            Create your first connector to start translating webhooks into RingCentral Adaptive Cards.
          </p>
          <Link 
            to="/connectors/new" 
            className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-6 py-3 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Connector
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {connectors.map(connector => (
            <div key={connector.id} className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:shadow-md transition-shadow">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{connector.name}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Created {formatDistanceToNow(new Date(connector.created_at))} ago
                </p>
              </div>
              
              <div className="flex-1 max-w-lg">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Webhook URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-600 truncate">
                    {connector.notification_url}
                  </code>
                  <button 
                    onClick={() => copyUrl(connector.notification_url, connector.id)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                    title="Copy URL"
                  >
                    {copiedId === connector.id ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                <button 
                  onClick={() => openTestModal(connector)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Test
                </button>
                <Link 
                  to={`/connectors/${connector.id}/history`}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Activity className="w-4 h-4" />
                  History
                </Link>
                <Link 
                  to={`/connectors/${connector.id}/edit`}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Edit
                </Link>
                <button 
                  onClick={() => handleDelete(connector.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testConnector && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Play className="w-5 h-5 text-indigo-600" />
                Test Connector: {testConnector.name}
              </h3>
              <button 
                onClick={() => setTestConnector(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex border-b border-slate-200 px-4">
              <button
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'payload' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                onClick={() => setActiveTab('payload')}
              >
                Webhook Payload
              </button>
              <button
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'template' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                onClick={() => setActiveTab('template')}
              >
                Adaptive Card Template
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto flex flex-col gap-4">
              {testResult && (
                <div className={`p-4 rounded-lg border ${testResult.status === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <h4 className={`font-semibold ${testResult.status === 'success' ? 'text-emerald-900' : 'text-red-900'}`}>
                    {testResult.message}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
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

              {activeTab === 'payload' ? (
                <div className="flex-1 flex flex-col">
                  <p className="text-sm text-slate-500 mb-2">
                    Paste a JSON payload below to simulate an incoming webhook.
                  </p>
                  <textarea
                    value={testPayload}
                    onChange={e => setTestPayload(e.target.value)}
                    className="w-full flex-1 min-h-[250px] p-4 bg-slate-900 border border-slate-800 rounded-lg font-mono text-sm text-emerald-400 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                    placeholder="Paste JSON payload here..."
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col">
                  <p className="text-sm text-slate-500 mb-2">
                    Edit the Adaptive Card template. Changes will be saved when you click "Send Test".
                  </p>
                  <textarea
                    value={testTemplate}
                    onChange={e => setTestTemplate(e.target.value)}
                    className="w-full flex-1 min-h-[250px] p-4 bg-slate-900 border border-slate-800 rounded-lg font-mono text-sm text-emerald-400 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                    placeholder="Adaptive Card JSON template..."
                  />
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                onClick={() => setTestConnector(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !testPayload}
                className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-70"
              >
                {testing ? 'Sending...' : 'Send Test'}
                <Play className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
