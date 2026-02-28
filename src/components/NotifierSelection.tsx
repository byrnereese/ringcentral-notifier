import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Lock } from 'lucide-react';

interface NotifierType {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  comingSoon?: boolean;
}

const NOTIFIER_TYPES: NotifierType[] = [
  {
    id: 'clio',
    name: 'Clio',
    description: 'Connect to Clio Manage to receive notifications about Matters, Contacts, and more.',
    icon: 'https://cdn.worldvectorlogo.com/logos/clio-1.svg', // Placeholder or use text
    enabled: true
  },
  {
    id: 'hootsuite',
    name: 'Hootsuite',
    description: 'Receive updates from your social media channels.',
    icon: '',
    enabled: false,
    comingSoon: true
  },
  {
    id: 'birdeye',
    name: 'BirdEye',
    description: 'Get notified about new reviews and customer feedback.',
    icon: '',
    enabled: false,
    comingSoon: true
  },
  {
    id: 'custom',
    name: 'Custom Notifier',
    description: 'Create a generic webhook endpoint to receive data from any service.',
    icon: '',
    enabled: true
  }
];

export default function NotifierSelection() {
  const navigate = useNavigate();

  const handleSelect = (type: NotifierType) => {
    if (!type.enabled) return;
    
    if (type.id === 'custom') {
      navigate('/notifiers/new');
    } else {
      navigate(`/notifiers/new?provider=${type.id}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <button
          onClick={() => navigate('/')}
          className="flex items-center text-sm text-slate-500 hover:text-slate-700 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Dashboard
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Create New Notifier</h1>
        <p className="text-slate-500 mt-1">Select a service to connect with RingCentral Team Messaging.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {NOTIFIER_TYPES.map((type) => (
          <div
            key={type.id}
            onClick={() => handleSelect(type)}
            className={`
              relative group rounded-xl border p-6 transition-all duration-200
              ${type.enabled 
                ? 'bg-white border-slate-200 hover:border-indigo-500 hover:shadow-md cursor-pointer' 
                : 'bg-slate-50 border-slate-200 opacity-75 cursor-not-allowed'}
            `}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xl">
                {type.icon ? <img src={type.icon} alt={type.name} className="w-8 h-8" onError={(e) => (e.currentTarget.style.display = 'none')} /> : type.name[0]}
              </div>
              {type.comingSoon && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                  Coming Soon
                </span>
              )}
            </div>
            
            <h3 className="text-lg font-semibold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
              {type.name}
            </h3>
            <p className="text-sm text-slate-500 mb-4 h-10">
              {type.description}
            </p>

            <div className={`
              flex items-center text-sm font-medium
              ${type.enabled ? 'text-indigo-600' : 'text-slate-400'}
            `}>
              {type.enabled ? (
                <>
                  Select <ArrowLeft className="w-4 h-4 ml-1 rotate-180" />
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 mr-1" /> Locked
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
