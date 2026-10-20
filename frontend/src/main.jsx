import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL;
const NAV = [
  ['overview', 'Overview', '⌂'],
  ['receiver', 'Receiver', '◈'],
  ['projects', 'Projects', '▦'],
  ['keys', 'API keys', '⌁'],
  ['logs', 'Logs', '≡'],
  ['docs', 'API docs', '▤'],
  ['settings', 'Settings', '⚙'], 
];

function App() {
  const [page, setPage] = useState('overview');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keys, setKeys] = useState([]);
  const [logs, setLogs] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('openrelay-theme') || 'dark');
  const [health, setHealth] = useState(false);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newProject, setNewProject] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [recipient, setRecipient] = useState('user_123');
  const [title, setTitle] = useState('Order shipped');
  const [message, setMessage] = useState('Your order #4821 has been shipped.');
  const [type, setType] = useState('general');

  const request = async (path, options = {}) => {
    const r = await fetch(`${API}${path}`, options);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  };
  const auth = () => apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const setCurrentKey = (value) => { setApiKey(value); if (project && value) sessionStorage.setItem(`openrelay-key:${project.id}`, value); };
  const notify = (message, kind = 'success') => {
    setToast({ message, kind });
    clearTimeout(window.__orToast);
    window.__orToast = setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('openrelay-theme', theme); }, [theme]);
  useEffect(() => { loadProjects(); checkHealth(); const t = setInterval(checkHealth, 10000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!project) { setApiKey(''); return; }
    const cached = sessionStorage.getItem(`openrelay-key:${project.id}`) || '';
    setApiKey(cached);
    setShowKey(false);
  }, [project?.id]);

  useEffect(() => {
    if (!project || !apiKey) return;
    sessionStorage.setItem(`openrelay-key:${project.id}`, apiKey);
    loadLogs(); loadKeys();
    let source;
    try {
      source = new EventSource(`${API}/api/projects/${project.id}/events?token=${encodeURIComponent(apiKey)}`);
      source.onmessage = (event) => {
        try { const payload = JSON.parse(event.data); if (payload.event?.startsWith('notification.')) loadLogs(); } catch {}
      };
    } catch {}
    return () => source?.close();
  }, [project?.id, apiKey]);

  async function checkHealth() { try { const d = await request('/health'); setHealth(Boolean(d.ok)); } catch { setHealth(false); } }
  async function loadProjects() {
    try {
      const data = await request('/api/projects'); setProjects(data);
      if (project) { const fresh = data.find(p => p.id === project.id); if (fresh) setProject(fresh); }
      else if (data[0]) setProject(data[0]);
    } catch (e) { notify(e.message, 'error'); }
  }
  async function loadLogs() { if (!project || !apiKey) return; try { setLogs(await request(`/api/projects/${project.id}/notifications?limit=200`, { headers: auth() })); } catch (e) { if (!String(e.message).includes('Invalid')) notify(e.message, 'error'); } }
  async function loadKeys() { if (!project || !apiKey) return; try { setKeys(await request(`/api/projects/${project.id}/keys`, { headers: auth() })); } catch (e) { if (!String(e.message).includes('Invalid')) notify(e.message, 'error'); } }

  async function createProject(e) {
    e.preventDefault(); const name = newProject.trim(); if (!name) return;
    setBusy(true);
    try { const d = await request('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name}) }); setNewProject(''); setProject(d.project); setCurrentKey(d.apiKey); await loadProjects(); setModal({type:'new-key', key:d.apiKey, title:'Project created'}); notify('Project created successfully.'); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  async function createKey(e) {
    e.preventDefault(); if (!project || !apiKey) return notify('Select a project and enter an active API key.','error');
    setBusy(true);
    try { const d = await request(`/api/projects/${project.id}/keys`, { method:'POST', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify({name:newKeyName.trim() || 'API key'}) }); setNewKeyName(''); setCurrentKey(d.apiKey); await loadKeys(); setModal({type:'new-key',key:d.apiKey,title:'API key created'}); notify('New API key created.'); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  async function revokeKey(id) {
    try { await request(`/api/projects/${project.id}/keys/${id}/revoke`, {method:'POST',headers:auth()}); await loadKeys(); notify('API key revoked.'); }
    catch(e){ notify(e.message,'error'); }
  }
  async function deleteProject() {
    if (!project || !apiKey) return notify('Enter a valid active project API key first.','error');
    setBusy(true);
    try { await request(`/api/projects/${project.id}`, {method:'DELETE',headers:auth()}); const deleted=project.name; setModal(null); setProject(null); setApiKey(''); setLogs([]); setKeys([]); sessionStorage.removeItem(`openrelay-key:${project.id}`); await loadProjects(); setPage('projects'); notify(`Deleted ${deleted}.`); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  async function sendNotification(e) {
    e.preventDefault(); if (!apiKey) return notify('Enter a project API key first.','error');
    if (!recipient.trim() || !title.trim() || !message.trim()) return notify('Recipient, title and message are required.','error');
    setBusy(true);
    try { const d = await request('/api/v1/notifications', {method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({recipient,title,message,type})}); notify(`Notification ${d.id.slice(0,8)} queued.`); await loadLogs(); setPage('logs'); }
    catch(e){ notify(e.message,'error'); } finally { setBusy(false); }
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); } catch { notify('Copy failed. Select and copy manually.','error'); } };

  const stats = useMemo(() => ({
    total: logs.length,
    delivered: logs.filter(x=>x.status==='delivered').length,
    queued: logs.filter(x=>x.status==='queued').length,
    failed: logs.filter(x=>x.status==='failed').length,
  }), [logs]);
  const filteredLogs = useMemo(() => logs.filter(n => {
    const q = search.trim().toLowerCase();
    const matchesQ = !q || [n.id,n.recipient,n.title,n.message].some(v => String(v||'').toLowerCase().includes(q));
    return matchesQ && (statusFilter === 'all' || n.status === statusFilter);
  }), [logs,search,statusFilter]);

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark">O</div><div><strong>OpenRelay</strong><span>Self-hosted notifications</span></div></div>
      <div className="projectSelectSide">
        <span>WORKSPACE</span>
        <select value={project?.id || ''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);setProject(p||null);}}><option value="">Select project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <nav>{NAV.map(([id,label,icon])=><button key={id} className={page===id?'navItem active':'navItem'} onClick={()=>setPage(id)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebarBottom"><div className="instance"><i className={health?'online':'offline'}></i><div><b>{health?'Operational':'Offline'}</b><small>Local instance</small></div></div><button className="themeMini" onClick={()=>setTheme(theme==='dark'?'light':'dark')}><span>{theme==='dark'?'☀':'☾'}</span>{theme==='dark'?'Light mode':'Dark mode'}</button></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="mobileBrand"><div className="brandMark">O</div><b>OpenRelay</b></div>
        <div><div className="eyebrow">Developer console</div><h1>{NAV.find(x=>x[0]===page)?.[1]}</h1><p>{page==='overview'?'Send, inspect and debug notifications from one lightweight console.':page==='receiver'?'Real-time notification listener via Server-Sent Events (SSE).':page==='projects'?'Organize notification traffic by application.':page==='keys'?'Manage the credentials your applications use.':page==='logs'?'Monitor delivery activity and troubleshoot failures.':page==='docs'?'Copy the integration you need and ship.':'Control appearance and instance details.'}</p></div>
        <div className="topActions"><span className="healthBadge"><i className={health?'online':'offline'}></i>{health?'All systems operational':'API unavailable'}</span></div>
      </header>

      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind==='success'?'✓':'!'}</span><b>{toast.message}</b><button onClick={()=>setToast(null)}>×</button></div>}

      {page==='overview' && <>
        <div className="heroBar">
          <div><span className="sectionLabel">ACTIVE PROJECT</span><div className="projectPicker"><select value={project?.id||''} onChange={e=>{const p=projects.find(x=>x.id===e.target.value);setProject(p||null);}}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button onClick={()=>setPage('projects')}>Manage projects</button></div></div>
          <form className="newProjectForm" onSubmit={createProject}><input value={newProject} onChange={e=>setNewProject(e.target.value)} placeholder="New project name" maxLength="80"/><button disabled={busy}>{busy?'Creating…':'New project'}</button></form>
        </div>
        {!project ? <EmptyState icon="＋" title="Create your first project" text="A project keeps API keys, notification history and monitoring isolated for one application." action="Create project" onClick={()=>document.querySelector('.newProjectForm input')?.focus()}/> : <>
          <div className="statGrid"><Stat label="Total notifications" value={stats.total} hint="Last 200 records"/><Stat label="Delivered" value={stats.delivered} tone="green" hint="Successfully processed"/><Stat label="Queued" value={stats.queued} tone="amber" hint="Waiting for delivery"/><Stat label="Failed" value={stats.failed} tone="red" hint="Needs investigation"/></div>
          <div className="grid2">
            <Panel title="Send a notification" subtitle="Test the same authenticated endpoint your app will use."><form className="form" onSubmit={sendNotification}><Field label="Project API key"><div className="keyInput"><input value={apiKey} onChange={e=>setCurrentKey(e.target.value)} placeholder="Paste or_live_…" autoComplete="off" type={showKey?'text':'password'}/><button type="button" onClick={()=>setShowKey(v=>!v)}>{showKey?'Hide':'Show'}</button><button type="button" onClick={()=>{setApiKey(''); if(project) sessionStorage.removeItem(`openrelay-key:${project.id}`);}}>Clear</button></div></Field><div className="formRow"><Field label="Recipient"><input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="user_123"/></Field><Field label="Type"><select value={type} onChange={e=>setType(e.target.value)}><option>general</option><option>order</option><option>alert</option><option>system</option></select></Field></div><Field label="Title"><input value={title} onChange={e=>setTitle(e.target.value)} maxLength="160"/></Field><Field label="Message"><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength="4000"/></Field><button className="primary wide" disabled={busy}>{busy?'Sending…':'Send notification'} <span>→</span></button></form></Panel>
            <Panel title="Quick integration" subtitle="One authenticated request. No dashboard dependency."><Code text={`curl -X POST ${API}/api/v1/notifications \\\n  -H "Authorization: Bearer or_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "recipient": "user_123",\n    "title": "Order Shipped",\n    "message": "Your order is on the way."\n  }'`} onCopy={()=>copy(`curl -X POST ${API}/api/v1/notifications`)} /><div className="infoCallout"><span>i</span><div><b>Simple by design</b><p>OpenRelay accepts the notification, records its lifecycle and exposes delivery status for debugging.</p></div></div><button className="textButton" onClick={()=>setPage('docs')}>View API documentation →</button></Panel>
          </div>
          <LogTable logs={logs.slice(0,6)} onView={()=>setPage('logs')}/>
        </>}
      </>}

      {page==='receiver' && <ReceiverPage project={project} apiKey={apiKey} request={request} auth={auth} notify={notify} setPage={setPage} copy={copy} />}

      {page==='projects' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">WORKSPACE</span><h2>Your projects</h2><p>Each project has its own API keys and notification history.</p></div><form className="createInline" onSubmit={createProject}><input value={newProject} onChange={e=>setNewProject(e.target.value)} placeholder="Project name"/><button className="primary" disabled={busy}>Create project</button></form></div><div className="projectGrid">{projects.map(p=><article className={`projectCard ${project?.id===p.id?'selected':''}`} key={p.id}><button className="projectMain" onClick={()=>{setProject(p);setPage('overview')}}><div className="projectAvatar">{p.name.slice(0,1).toUpperCase()}</div><div><h3>{p.name}</h3><span>{p.notification_count||0} notifications</span><small>{new Date(p.created_at).toLocaleDateString()}</small></div></button><div className="cardActions"><button onClick={()=>{setProject(p);setPage('overview')}}>Open</button><button className="dangerText" onClick={()=>setModal({type:'delete-project',project:p})}>Delete</button></div></article>)}</div>{!projects.length&&<EmptyState icon="▦" title="No projects yet" text="Create a project to get an API key and start sending notifications."/>}</section>}

      {page==='keys' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">CREDENTIALS</span><h2>API keys</h2><p>Keys authenticate requests to your OpenRelay instance.</p></div><div className="projectPill">{project?project.name:'No project selected'}</div></div>{project&&apiKey?<><form className="createKey" onSubmit={createKey}><input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key name, e.g. Production"/><button className="primary" disabled={busy}>{busy?'Generating…':'Generate API key'}</button></form><div className="securityNote"><span>⌁</span><div><b>Store keys like passwords</b><p>The full secret is only displayed once when created. OpenRelay stores a hash, not the raw key.</p></div></div><div className="keyList">{keys.map(k=><div className="keyRow" key={k.id}><div className="keyIdentity"><div className="keyIcon">⌁</div><div><b>{k.name}</b><span>{k.key_prefix}••••••••</span></div></div><div className="keyMeta"><span className={k.revoked_at?'status revoked':'status active'}>{k.revoked_at?'Revoked':'Active'}</span><small>{k.last_used_at?`Last used ${new Date(k.last_used_at).toLocaleString()}`:`Created ${new Date(k.created_at).toLocaleDateString()}`}</small>{!k.revoked_at&&<button className="dangerOutline" onClick={()=>setModal({type:'revoke-key',key:k})}>Revoke</button>}</div></div>)}{!keys.length&&<EmptyState icon="⌁" title="No API keys" text="Create a key for this project to authenticate your application."/>}</div></>:<EmptyState icon="⌁" title="Select a project" text="Choose a project and enter one of its active API keys on Overview to manage credentials." action="Go to overview" onClick={()=>setPage('overview')}/>}</section>}

      {page==='logs' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">MONITORING</span><h2>Notification logs</h2><p>Search and inspect delivery activity for the active project.</p></div><div className="logStats"><span><b>{stats.total}</b>Total</span><span><b className="greenText">{stats.delivered}</b>Delivered</span><span><b className="redText">{stats.failed}</b>Failed</span></div></div>{project&&apiKey?<><div className="filters"><div className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipient, title or ID…"/></div><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="delivered">Delivered</option><option value="queued">Queued</option><option value="failed">Failed</option></select></div><LogTable logs={filteredLogs} full/></>:<EmptyState icon="≡" title="Nothing to monitor yet" text="Select a project and provide an active API key to load its notification history." action="Go to overview" onClick={()=>setPage('overview')}/>}</section>}

      {page==='docs' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">DEVELOPER API</span><h2>API documentation</h2><p>Everything needed to send and inspect notifications.</p></div></div><div className="docsGrid"><Panel title="Create notification" subtitle="POST /api/v1/notifications"><Code text={`POST ${API}/api/v1/notifications\nAuthorization: Bearer or_live_...\nContent-Type: application/json\n\n{\n  "recipient": "user_123",\n  "title": "Order Shipped",\n  "message": "Your order is on the way.",\n  "type": "order"\n}`} onCopy={()=>copy(`POST ${API}/api/v1/notifications`)}/></Panel><Panel title="Response" subtitle="Accepted for processing"><Code text={`{\n  "id": "notification-uuid",\n  "status": "queued"\n}`} /><p className="docText">The notification is recorded first, then its delivery status is updated. Use the returned ID to inspect the notification.</p><Code text={`GET ${API}/api/v1/notifications/:id\nAuthorization: Bearer or_live_...`} /></Panel></div></section>}

      {page==='settings' && <section className="pageSection"><div className="pageIntro"><div><span className="sectionLabel">PREFERENCES</span><h2>Settings</h2><p>Keep the console comfortable and your instance easy to understand.</p></div></div><div className="settingsGrid"><Panel title="Appearance" subtitle="Choose the interface theme"><div className="themeCards"><button className={theme==='light'?'themeCard selected':'themeCard'} onClick={()=>setTheme('light')}><div className="preview lightPreview"><i></i><i></i><i></i></div><b>Light</b><span>Clean and bright</span></button><button className={theme==='dark'?'themeCard selected':'themeCard'} onClick={()=>setTheme('dark')}><div className="preview darkPreview"><i></i><i></i><i></i></div><b>Dark</b><span>Low-light interface</span></button></div></Panel><Panel title="Instance" subtitle="Current OpenRelay environment"><div className="settingsList"><div><span>Dashboard</span><b>localhost:5173</b></div><div><span>API</span><b>localhost:4000</b></div><div><span>Database</span><b>PostgreSQL 16</b></div><div><span>Status</span><b className={health?'greenText':'redText'}>{health?'Operational':'Unavailable'}</b></div><div><span>Deployment</span><b>Docker Compose</b></div></div></Panel></div><Panel title="Self-hosting" subtitle="Deployment guidance"><div className="selfHostCopy"><b>Your infrastructure, your data.</b><p>Run OpenRelay on your own Linux VM or server. Put Nginx in front of the dashboard and API, keep PostgreSQL private, enable HTTPS and provide secrets through environment variables.</p></div></Panel>{project&&<Panel title="Danger zone" subtitle={`Destructive actions for ${project.name}`} danger><div className="dangerBox"><div><b>Delete project</b><p>Permanently removes the project, API keys and notification history.</p></div><button className="dangerButton" onClick={()=>setModal({type:'delete-project',project})}>Delete project</button></div></Panel>}</section>}
    </main>

    {modal && <Modal modal={modal} onClose={()=>setModal(null)} onCopy={copy} onDelete={deleteProject} onRevoke={()=>{revokeKey(modal.key.id);setModal(null)}} busy={busy}/>} 
  </div>;
}

function Modal({modal,onClose,onCopy,onDelete,onRevoke,busy}) {
  if(modal.type==='new-key') return <div className="modalBackdrop"><div className="modal"><div className="modalIcon success">✓</div><h3>{modal.title}</h3><p>This secret is shown only once. Copy it now and store it securely.</p><div className="secretBox"><code>{modal.key}</code><button onClick={()=>onCopy(modal.key)}>Copy</button></div><button className="primary wide" onClick={onClose}>Done</button></div></div>;
  if(modal.type==='revoke-key') return <div className="modalBackdrop"><div className="modal"><div className="modalIcon warning">!</div><h3>Revoke API key?</h3><p><b>{modal.key.name}</b> will immediately stop authenticating requests. This cannot be undone.</p><div className="modalActions"><button className="secondary" onClick={onClose}>Cancel</button><button className="dangerButton" onClick={onRevoke}>Revoke key</button></div></div></div>;
  return <div className="modalBackdrop"><div className="modal"><div className="modalIcon dangerIcon">!</div><h3>Delete “{modal.project.name}”?</h3><p>This permanently removes the project, all API keys and notification logs. Type the project name to confirm.</p><input autoFocus placeholder={modal.project.name} onKeyDown={e=>{if(e.key==='Enter'&&e.currentTarget.value===modal.project.name)onDelete();}}/><div className="modalActions"><button className="secondary" onClick={onClose}>Cancel</button><button className="dangerButton" disabled={busy} onClick={(e)=>{const input=e.currentTarget.parentElement.previousElementSibling;if(input.value===modal.project.name)onDelete();}}>{busy?'Deleting…':'Delete project'}</button></div></div></div>;
}
function Stat({label,value,hint,tone=''}){return <div className="statCard"><div className={`statDot ${tone}`}></div><span>{label}</span><b>{value}</b><small>{hint}</small></div>}
function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>}
function Panel({title,subtitle,children,danger=false}){return <section className={danger?'panel dangerPanel':'panel'}><div className="panelHead"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div></div>{children}</section>}
function Code({text,onCopy}){return <div className="codeWrap"><pre><code>{text}</code></pre>{onCopy&&<button className="copyButton" onClick={onCopy}>Copy</button>}</div>}
function EmptyState({icon,title,text,action,onClick}){return <div className="emptyState"><div className="emptyIcon">{icon}</div><h3>{title}</h3><p>{text}</p>{action&&<button className="primary" onClick={onClick}>{action}</button>}</div>}
function LogTable({logs,onView,full=false}){return <section className="panel logPanel"><div className="panelHead"><div><h3>{full?'Activity':'Recent notifications'}</h3><p>{full?'Latest delivery records for the selected project.':'The latest notification activity.'}</p></div>{onView&&logs.length>0&&<button className="textButton" onClick={onView}>View all →</button>}</div>{!logs.length?<div className="emptyTable">No notifications match your current view.</div>:<div className="tableScroll"><div className="logTable"><div className="logRow header"><span>Notification</span><span>Recipient</span><span>Status</span><span>Created</span></div>{logs.map(n=><div className="logRow" key={n.id}><span><b>{n.title}</b><p className='notificationMessage'>{n.message}</p> <small>{n.id}</small></span><span>{n.recipient}</span><span><i className={`statusDot ${n.status}`}></i>{n.status}</span><span>{new Date(n.created_at).toLocaleString()}</span></div>)}</div></div>}</section>}

function ReceiverPage({ project, apiKey, request, auth, notify, setPage, copy }) {
  const [feed, setFeed] = useState([]);
  const [pendingBuffer, setPendingBuffer] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connStatus, setConnStatus] = useState(!project || !apiKey ? 'disconnected' : 'connecting');
  const [sessionCount, setSessionCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [reconnectKey, setReconnectKey] = useState(0);

  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!project || !apiKey) return;
    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) {
        setLoading(true);
        setError(null);
      }
    });

    request(`/api/projects/${project.id}/notifications?limit=50`, { headers: auth() })
      .then((data) => {
        if (isMounted) {
          setFeed(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [project?.id, apiKey, reconnectKey]);

  useEffect(() => {
    if (!project || !apiKey) return;

    let source;
    try {
      queueMicrotask(() => setConnStatus('connecting'));
      source = new EventSource(`${API}/api/projects/${project.id}/events?token=${encodeURIComponent(apiKey)}`);

      source.onopen = () => {
        setConnStatus('connected');
        setError(null);
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.event === 'connected') {
            setConnStatus('connected');
            return;
          }

          if (payload.event === 'notification.created') {
            const raw = payload.data || payload;
            const newNotif = {
              id: raw.id,
              recipient: raw.recipient,
              title: raw.title,
              message: raw.message,
              type: raw.type || 'general',
              status: raw.status || 'queued',
              created_at: raw.created_at || new Date().toISOString(),
              isLive: true,
              raw: payload
            };

            setSessionCount(prev => prev + 1);

            if (pausedRef.current) {
              setPendingBuffer(prev => [newNotif, ...prev.filter(x => x.id !== newNotif.id)]);
            } else {
              setFeed(prev => [newNotif, ...prev.filter(x => x.id !== newNotif.id)]);
            }
          } else if (payload.event === 'notification.updated') {
            const raw = payload.data || payload;
            setFeed(prev => prev.map(item => (item.id === raw.id ? { ...item, status: raw.status || item.status } : item)));
          }
        } catch (e) {
          console.error('SSE event parse error:', e);
        }
      };

      source.onerror = () => {
        if (source.readyState === EventSource.CONNECTING) {
          setConnStatus('reconnecting');
        } else if (source.readyState === EventSource.CLOSED) {
          setConnStatus('disconnected');
        }
      };
    } catch (err) {
      queueMicrotask(() => {
        setConnStatus('error');
        setError(err.message);
      });
    }

    return () => {
      source?.close();
    };
  }, [project?.id, apiKey, reconnectKey]);

  const flushBuffer = () => {
    if (pendingBuffer.length > 0) {
      setFeed(prev => {
        const ids = new Set(pendingBuffer.map(p => p.id));
        return [...pendingBuffer, ...prev.filter(x => !ids.has(x.id))];
      });
      setPendingBuffer([]);
    }
  };

  const togglePause = () => {
    if (paused && pendingBuffer.length > 0) {
      flushBuffer();
    }
    setPaused(!paused);
  };

  const clearFeed = () => {
    setFeed([]);
    setPendingBuffer([]);
    notify('Receiver feed cleared.');
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredFeed = useMemo(() => {
    return feed.filter(item => {
      const q = search.trim().toLowerCase();
      const matchesQ = !q || [item.id, item.recipient, item.title, item.message].some(v => String(v || '').toLowerCase().includes(q));
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesType = typeFilter === 'all' || (item.type || 'general') === typeFilter;
      return matchesQ && matchesStatus && matchesType;
    });
  }, [feed, search, statusFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: feed.length,
    queued: feed.filter(x => x.status === 'queued').length,
    delivered: feed.filter(x => x.status === 'delivered').length,
    failed: feed.filter(x => x.status === 'failed').length,
  }), [feed]);

  if (!project || !apiKey) {
    return (
      <section className="pageSection">
        <div className="pageIntro">
          <div>
            <span className="sectionLabel">LIVE RECEIVER</span>
            <h2>Notification Receiver</h2>
            <p>Connect to real-time Server-Sent Events to receive and inspect notifications as they arrive.</p>
          </div>
        </div>
        <EmptyState 
          icon="◈" 
          title="Select a project and API key" 
          text="Choose a project and ensure an active API key is set on Overview to connect to the SSE receiver stream." 
          action="Go to overview" 
          onClick={() => setPage('overview')} 
        />
      </section>
    );
  }

  return (
    <section className="pageSection">
      <div className="pageIntro">
        <div>
          <span className="sectionLabel">LIVE RECEIVER</span>
          <h2>Notification Receiver</h2>
          <p>Listening for real-time notifications on <b>{project.name}</b></p>
        </div>
        <div className="receiverHeaderActions">
          <div className={`connectionPill ${connStatus}`} title={`Status: ${connStatus}`}>
            <i className={`liveDot ${connStatus}`}></i>
            <span>{connStatus === 'connected' ? 'Connected (Live)' : connStatus === 'connecting' ? 'Connecting…' : connStatus === 'reconnecting' ? 'Reconnecting…' : connStatus === 'error' ? 'Connection Error' : 'Disconnected'}</span>
          </div>
          <button className="secondary" onClick={() => setReconnectKey(k => k + 1)} title="Restart SSE connection">
            ↻ Reconnect
          </button>
        </div>
      </div>

      <div className="statGrid">
        <Stat label="Total in feed" value={stats.total} hint="Current receiver records" />
        <Stat label="Received live" value={sessionCount} tone="green" hint="Arrived during this session" />
        <Stat label="Queued status" value={stats.queued} tone="amber" hint="Awaiting delivery" />
        <Stat label="Delivered status" value={stats.delivered} tone="green" hint="Confirmed delivered" />
      </div>

      {error && (
        <div className="receiverErrorBanner">
          <div className="errorIcon">!</div>
          <div className="errorContent">
            <b>Connection Error</b>
            <p>{error}</p>
          </div>
          <button className="secondary" onClick={() => setReconnectKey(k => k + 1)}>Retry</button>
        </div>
      )}

      <div className="receiverToolbar">
        <div className="search">
          <span>⌕</span>
          <input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Filter by recipient, title, message or ID…" 
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="general">general</option>
          <option value="order">order</option>
          <option value="alert">alert</option>
          <option value="system">system</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="queued">Queued</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
        <button 
          className={`receiverBtn ${paused ? 'active' : ''}`} 
          onClick={togglePause}
          title={paused ? 'Resume live stream updates' : 'Pause incoming live updates'}
        >
          {paused ? '▶ Resume stream' : '❚❚ Pause stream'}
        </button>
        <button 
          className="receiverBtn" 
          onClick={clearFeed} 
          disabled={feed.length === 0}
          title="Clear the current receiver feed"
        >
          Clear feed
        </button>
      </div>

      {paused && pendingBuffer.length > 0 && (
        <div className="pendingNotice" onClick={flushBuffer}>
          <span>⚡ {pendingBuffer.length} new notification{pendingBuffer.length > 1 ? 's' : ''} received while paused</span>
          <button type="button">Show now →</button>
        </div>
      )}

      {loading ? (
        <div className="receiverLoadingState">
          <div className="receiverLoadingSpinner"></div>
          <b>Connecting to notification stream…</b>
          <p>Initializing SSE connection and loading recent records for {project.name}</p>
        </div>
      ) : filteredFeed.length === 0 ? (
        <div className="emptyState">
          <div className="emptyIcon">◈</div>
          <h3>{feed.length === 0 ? 'Waiting for notifications' : 'No matching notifications'}</h3>
          <p>
            {feed.length === 0 
              ? `Connected to SSE stream for ${project.name}. As soon as a notification is published, it will appear here in real time.` 
              : 'No notifications match your current search and filter criteria.'}
          </p>
          {feed.length === 0 && (
            <button className="primary" onClick={() => setPage('overview')}>Send a test notification →</button>
          )}
        </div>
      ) : (
        <div className="receiverFeed">
          {filteredFeed.map(item => (
            <article className={`receiverCard ${item.isLive ? 'livePulseCard' : ''}`} key={item.id}>
              <div className="receiverCardHeader">
                <div className="receiverCardTitleGroup">
                  <div className="receiverTitleRow">
                    <h4>{item.title}</h4>
                    {item.isLive && <span className="liveBadge">LIVE</span>}
                  </div>
                  <p className="receiverMessage">{item.message}</p>
                </div>
                <div className="receiverCardMeta">
                  <span className="receiverMetaItem">
                    <i className={`statusDot ${item.status}`}></i>
                    {item.status}
                  </span>
                  <span className="typeBadge">{item.type || 'general'}</span>
                  <time title={new Date(item.created_at).toLocaleString()}>
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </time>
                </div>
              </div>

              <div className="receiverCardFooter">
                <div className="receiverFooterLeft">
                  <span className="recipientTag">Recipient: <b>{item.recipient}</b></span>
                  <span className="idTag" onClick={() => copy(item.id)} title="Click to copy ID">
                    <code>{item.id}</code>
                  </span>
                </div>
                <button 
                  className="payloadToggleBtn" 
                  onClick={() => toggleExpand(item.id)}
                >
                  {expandedIds.has(item.id) ? 'Hide payload ▲' : 'Inspect payload ▼'}
                </button>
              </div>

              {expandedIds.has(item.id) && (
                <div className="payloadViewer">
                  <Code 
                    text={JSON.stringify(item.raw || item, null, 2)} 
                    onCopy={() => copy(JSON.stringify(item.raw || item, null, 2))} 
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
