import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Activity, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Log {
  id: string;
  status: string;
  inbound_request: string;
  generated_card: string;
  outbound_request?: string;
  outbound_response: string;
  created_at: string;
  is_test?: number;
}

export default function NotifierHistory({ userId }: { userId: string }) {
  const { id } = useParams();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, [id]);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/notifiers/${id}/logs`, {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleLog = (logId: string) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  const getErrorMessage = (log: Log) => {
    if (log.status === 'success') return null;
    try {
      const parsed = JSON.parse(log.outbound_response);
      return parsed.message || parsed.error_description || parsed.error || 'Unknown error occurred';
    } catch (e) {
      return log.outbound_response || 'Unknown error occurred';
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading history...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link 
          to="/dashboard"
          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-6 h-6 text-indigo-600" />
          Notifier History
        </h2>
      </div>

      {logs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No activity yet</h3>
          <p className="text-slate-500 max-w-sm mx-auto">
            Send a POST request to your notifier's webhook URL to see activity here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {logs.map(log => {
            const errorMessage = getErrorMessage(log);
            return (
              <div key={log.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all">
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => toggleLog(log.id)}
                >
                  <div className="flex items-center gap-4">
                    {log.status === 'success' ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                    ) : (
                      <XCircle className="w-6 h-6 text-red-500" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-900">
                          {log.status === 'success' ? 'Webhook Processed Successfully' : 'Webhook Processing Failed'}
                        </h4>
                        {log.is_test === 1 && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">
                            TEST
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {formatDistanceToNow(new Date(log.created_at))} ago
                      </p>
                    </div>
                  </div>
                  <button className="p-2 text-slate-400">
                    {expandedLogId === log.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>

                {expandedLogId === log.id && (
                  <div className="border-t border-slate-100 p-6 bg-slate-50 space-y-6">
                    {errorMessage && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
                        <div>
                          <h5 className="text-sm font-semibold text-red-900">Error Details</h5>
                          <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Inbound Request</h5>
                      <pre className="bg-slate-900 text-slate-300 p-4 rounded-lg text-xs font-mono overflow-auto max-h-64 border border-slate-800">
                        {JSON.stringify(JSON.parse(log.inbound_request), null, 2)}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Generated Adaptive Card</h5>
                      <pre className="bg-slate-900 text-emerald-400 p-4 rounded-lg text-xs font-mono overflow-auto max-h-64 border border-slate-800">
                        {log.generated_card ? JSON.stringify(JSON.parse(log.generated_card), null, 2) : 'N/A'}
                      </pre>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {log.outbound_request && (
                      <div className="space-y-2">
                        <h5 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Outbound Request (To RingCentral)</h5>
                        <pre className="bg-slate-900 text-indigo-300 p-4 rounded-lg text-xs font-mono overflow-auto max-h-48 border border-slate-800">
                          {JSON.stringify(JSON.parse(log.outbound_request), null, 2)}
                        </pre>
                      </div>
                    )}
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Outbound Response (From RingCentral)</h5>
                      <pre className={`p-4 rounded-lg text-xs font-mono overflow-auto max-h-48 border ${log.status === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                        {log.outbound_response}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
