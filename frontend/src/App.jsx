import { useEffect, useState } from 'react';
import { apiGet } from './api/client';

function App() {
  const [status,setStatus] = useState('checking...');

  useEffect(()=>{
    apiGet('/health')
    .then((data)=>{setStatus(data.status)})
    .catch(()=>{setStatus('backend unreachable')});
  },[]);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>OpenRelay</h1>
      <p>Backend status: {status}</p>
    </div>
  );
}

export default App;