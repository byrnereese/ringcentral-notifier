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
    <div className="min-h-screen bg-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-5xl mx-auto space-y-12">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-[#0662f6] rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <MessageSquare className="w-10 h-10 text-white" />
            </div>
          </div>
          
          <div className="space-y-6">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 leading-tight">
              <span className="text-[#ff5a00]">Plug in.</span> Master the flow. Stay informed.
            </h1>
            
            <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
              Your business is happening everywhere at once, creating a constant cacophony of data. RingCentral Notifier filters the noise, plucking the critical events out of the static and dropping them directly into your workflow.
            </p>
          </div>

          <div className="pt-8 pb-16">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="inline-flex items-center gap-3 bg-[#0662f6] text-white px-10 py-5 rounded-full text-xl font-medium hover:bg-[#004ecc] transition-all transform hover:scale-105 disabled:opacity-70 shadow-xl shadow-blue-200"
            >
              {loading ? 'Connecting...' : 'Login with RingCentral'}
              <ArrowRight className="w-6 h-6" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-left">
            <div className="space-y-4 p-6 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-[#0662f6]">
                <BellRing className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Awareness, Automated</h3>
                <p className="text-sm font-semibold text-[#ff5a00] uppercase tracking-wide mt-1">Isolate the signal. Silence the noise.</p>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Stop chasing updates across a dozen dashboards. Convert raw events from your third-party apps into actionable messages. Isolate the events that actually drive your business and deliver them exactly where your team already lives.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center text-[#ff5a00]">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Insight on Sight</h3>
                <p className="text-sm font-semibold text-[#0662f6] uppercase tracking-wide mt-1">Data, decoded.</p>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Raw logs are static; Adaptive Cards are signals. We transform complex data into sleek, high-fidelity visuals that give your stakeholders the full story at a glance. Move from "what happened?" to "what’s next?" in seconds.
              </p>
            </div>

            <div className="space-y-4 p-6 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-[#0662f6]">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Total Link</h3>
                <p className="text-sm font-semibold text-[#ff5a00] uppercase tracking-wide mt-1">Your ecosystem, unified.</p>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Connect your favorite tools to RingCentral and build a unified command center. No friction, no complex setup—just a seamless bridge between your service ecosystem and your team messaging.
              </p>
            </div>
          </div>

          <div className="pt-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-12">Supported Integrations</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              {[
                {
                  id: 'clio',
                  name: 'Clio',
                  description: 'Connect to Clio Manage to receive notifications about Matters, Contacts, and more.',
                  icon: '/icons/icon-clio.png'
                },
                {
                  id: 'hubspot',
                  name: 'HubSpot',
                  description: 'Receive notifications about Contact updates and new leads.',
                  icon: '/icons/icon-hubspot.png'
                },
                {
                  id: 'uservoice',
                  name: 'UserVoice',
                  description: 'Receive notifications about new suggestions and comments.',
                  icon: '/icons/icon-uservoice.png'
                },
                {
                  id: 'hootsuite',
                  name: 'Hootsuite',
                  description: 'Receive updates from your social media channels.',
                  icon: '/icons/icon-hootsuite.png',
                  comingSoon: true
                },
                {
                  id: 'birdeye',
                  name: 'BirdEye',
                  description: 'Get notified about new reviews and customer feedback.',
                  icon: '/icons/icon-birdeye.png',
                  comingSoon: true
                },
                {
                  id: 'custom',
                  name: 'Custom Webhook',
                  description: 'Connect any service that supports webhooks.',
                  iconComponent: <Zap className="w-8 h-8 text-slate-600" />
                }
              ].map((integration) => (
                <div key={integration.id} className="group p-6 rounded-2xl bg-white border border-slate-200 hover:border-blue-500 hover:shadow-md transition-all duration-200">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-lg bg-slate-50 flex items-center justify-center overflow-hidden">
                      {integration.icon ? (
                        <img src={integration.icon} alt={integration.name} className="w-full h-full object-cover" />
                      ) : (
                        integration.iconComponent
                      )}
                    </div>
                    {integration.comingSoon && (
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">Coming Soon</span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">{integration.name}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{integration.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="bg-slate-900 text-slate-400 py-12 px-6 mt-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h4 className="text-white font-semibold text-lg">About RingCentral Labs</h4>
            <p className="text-sm leading-relaxed">
              RingCentral Notifier is a RingCentral Labs product. While Labs projects operate outside of our official commercial SLAs and formal support channels, we are committed to delivering tools that meet the high-quality standards and performance expectations of our core product suite.
            </p>
          </div>
          <div className="flex flex-col justify-end md:items-end space-y-4">
            <div className="flex items-center gap-2 text-white font-semibold">
              <div className="w-6 h-6 bg-[#0662f6] rounded flex items-center justify-center text-[10px]">RC</div>
              <span>RingCentral Notifier</span>
            </div>
            <p className="text-sm">
              © 2026 RingCentral, Inc. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
