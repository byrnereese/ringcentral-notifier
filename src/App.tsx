import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import NotifierForm from './components/NotifierForm';
import NotifierHistory from './components/NotifierHistory';

export default function App() {
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('userId'));

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        localStorage.setItem('userId', event.data.userId);
        setUserId(event.data.userId);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('userId');
    setUserId(null);
  };

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        {userId && (
          <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#0662f6] rounded-lg flex items-center justify-center text-white font-bold">RC</div>
              <h1 className="text-xl font-semibold">RingCentral Notifier</h1>
            </div>
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-900">
              Logout
            </button>
          </header>
        )}
        <main className={userId ? "max-w-7xl mx-auto p-6" : ""}>
          <Routes>
            <Route path="/" element={userId ? <Navigate to="/dashboard" /> : <LandingPage />} />
            <Route path="/dashboard" element={userId ? <Dashboard userId={userId} /> : <Navigate to="/" />} />
            <Route path="/notifiers/new" element={userId ? <NotifierForm userId={userId} /> : <Navigate to="/" />} />
            <Route path="/notifiers/:id/edit" element={userId ? <NotifierForm userId={userId} /> : <Navigate to="/" />} />
            <Route path="/notifiers/:id/history" element={userId ? <NotifierHistory userId={userId} /> : <Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
