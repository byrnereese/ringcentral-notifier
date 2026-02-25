import { useState } from 'react';
import { MessageSquare, Zap, ArrowRight, ShieldCheck, Activity, Globe, BellRing } from 'lucide-react';

export default function LandingPage() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        data.url,
        'rc_oauth',
        `width=${width},height=${height},top=${top},left=${left}`
      );
    } catch (error) {
      console.error('Failed to get auth URL', error);
      alert('Failed to connect to RingCentral');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 bg-[#0662f6] rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
        </div>
        
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-slate-900">
          <span className="text-[#ff5a00]">Plug in.</span> Increase your situational awareness of your business.
        </h1>
        
        <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Be notified in RingCentral of key events happening across your entire service ecosystem. Ensure your stakeholders always know what is going on.
        </p>

        <div className="pt-8">
          <button
            onClick={handleLogin}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-[#0662f6] text-white px-8 py-4 rounded-full text-lg font-medium hover:bg-[#004ecc] transition-colors disabled:opacity-70 shadow-lg shadow-blue-200"
          >
            {loading ? 'Connecting...' : 'Login with RingCentral'}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-16 text-left">
          <div className="space-y-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-[#0662f6]">
              <BellRing className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900">Real-Time Notifications</h3>
            <p className="text-slate-600 text-sm">Convert events from third-party apps into actionable messages posted directly to your team conversations.</p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-[#ff5a00]">
              <Activity className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900">Actionable Insights</h3>
            <p className="text-slate-600 text-sm">Transform raw data into beautiful, easy-to-read Adaptive Cards that keep everyone informed at a glance.</p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-[#0662f6]">
              <Globe className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900">Seamless Integration</h3>
            <p className="text-slate-600 text-sm">Connect your favorite tools to RingCentral in seconds and build a unified command center for your team.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
