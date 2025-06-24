import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

const StatusCard = ({ title, value, loading }) => (
  <div className="bg-white shadow rounded-xl p-6 flex flex-col justify-between w-full h-36">
    <span className="text-lg font-semibold mb-4">{title}</span>
    <div className="flex items-center justify-center flex-grow">
      {loading ? (
        <span className="animate-spin">
          <Loader2 className="text-3xl" />
        </span>
      ) : value === true ? (
        <CheckCircle2 className="text-green-500 text-4xl" />
      ) : value === false ? (
        <XCircle className="text-red-500 text-4xl" />
      ) : (
        <span className="text-gray-600 text-lg">{value || 'N/A'}</span>
      )}
    </div>
  </div>
);

export default function App() {
  const [statuses, setStatuses] = useState({
    vm: null,
    win: null,
    steam: null,
    driver: null,
  });
  const [loading, setLoading] = useState(true);
  const [creationStatus, setCreationStatus] = useState('idle');

  const fetchStatuses = async () => {
    setLoading(true);
    try {
      const [vm, win, steam, driver] = await Promise.all([
        axios.get('/api/vm-status'),
        axios.get('/api/windows-status'),
        axios.get('/api/steam-status'),
        axios.get('/api/display-driver-status'),
      ]);
      setStatuses({
        vm: vm.data.status === 'running',
        win: win.data.reachable,
        steam: steam.data.steamRunning,
        driver: driver.data.displayDriverLoaded,
      });
    } catch (err) {
      console.error(err);
      setStatuses({
        vm: false,
        win: false,
        steam: false,
        driver: false,
      });
    }
    setLoading(false);
  };

  const recreateVM = async () => {
    setCreationStatus('loading');
    try {
      const res = await axios.post('/api/clone-vm');
      alert(`✅ VM cloned: ${res.data.name} (ID: ${res.data.vmid})`);
      setCreationStatus('success');
      fetchStatuses();
    } catch (err) {
      console.error(err);
      alert('❌ Failed to clone VM');
      setCreationStatus('error');
    }
  };

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-8">Steam VM Monitor</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-5xl">
        <StatusCard title="VM Running" value={statuses.vm} loading={loading} />
        <StatusCard title="Windows Online" value={statuses.win} loading={loading} />
        <StatusCard title="Steam Running" value={statuses.steam} loading={loading} />
        <StatusCard title="Display Driver Loaded" value={statuses.driver} loading={loading} />
      </div>

      <button
        className="mt-10 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl disabled:opacity-50 transition"
        disabled={creationStatus === 'loading'}
        onClick={recreateVM}
      >
        {creationStatus === 'loading' ? 'Recreating VM...' : 'Recreate VM'}
      </button>
    </div>
  );
}
