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
  const [notifiers, setNotifiers] = useState<Notifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchNotifiers();
  }, [userId]);

  const fetchNotifiers = async () => {
    try {
      const res = await fetch('/api/notifiers', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      setNotifiers(data);
    } catch (error) {
      console.error('Failed to fetch notifiers', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notifier?')) return;
    
    try {
      await fetch(`/api/notifiers/${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId }
      });
      setNotifiers(notifiers.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to delete notifier', error);
    }
  };

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading notifiers...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Your Notifiers</h2>
        <Link 
          to="/notifiers/select" 
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Notifier
        </Link>
      </div>

      {notifiers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No notifiers yet</h3>
          <p className="text-slate-500 mb-6 max-w-sm mx-auto">
            Create your first notifier to start translating webhooks into RingCentral Team Messaging.
          </p>
          <Link 
            to="/notifiers/select" 
            className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-6 py-3 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Notifier
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {notifiers.map(notifier => (
            <div key={notifier.id} className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:shadow-md transition-shadow">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{notifier.name}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Created {formatDistanceToNow(new Date(notifier.created_at))} ago
                </p>
              </div>
              
              <div className="flex-1 max-w-lg">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Webhook URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-600 truncate">
                    {notifier.notification_url}
                  </code>
                  <button 
                    onClick={() => copyUrl(notifier.notification_url, notifier.id)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                    title="Copy URL"
                  >
                    {copiedId === notifier.id ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                <Link 
                  to={`/notifiers/${notifier.id}/history`}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Activity className="w-4 h-4" />
                  History
                </Link>
                <Link 
                  to={`/notifiers/${notifier.id}/edit`}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Edit
                </Link>
                <button 
                  onClick={() => handleDelete(notifier.id)}
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
    </div>
  );
}
