const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}