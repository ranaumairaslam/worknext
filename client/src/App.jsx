import { useState } from 'react';

// Vite proxies this path to the Express server during development. Set
// VITE_API_URL in production (for example, https://api.example.com/api).
const API_URL = import.meta.env.VITE_API_URL || '/api';
const initialForm = { name: '', email: '', password: '' };
const initialCompanyForm = {
  companyName: '',
  ownerName: '',
  email: '',
  password: '',
  phone: '',
  address: '',
  industry: '',
  website: '',
};

export default function App() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [testToken, setTestToken] = useState(() => localStorage.getItem('testToken') || '');
  const [companyForm, setCompanyForm] = useState(initialCompanyForm);
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const endpoint = mode === 'login' ? `${API_URL}/login` : `${API_URL}/company/signup`;
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { companyName: form.name, name: form.name, email: form.email, password: form.password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.errors?.map((item) => item.message).join(', ') || data.message || 'Request failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setMessage(data.message);
      setForm(initialForm);
    } catch (requestError) {
      setError(requestError.message || 'Unable to connect to the API');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setMessage('You have been logged out.');
  };

  const generateDemoToken = async (showMessage = true) => {
    setTestLoading(true);
    setTestError('');
    if (showMessage) {
      setTestMessage('');
    }

    try {
      const response = await fetch(`${API_URL}/dev/super-admin-token`, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Unable to generate a test token');
      }

      localStorage.setItem('testToken', data.token);
      setTestToken(data.token);
      if (showMessage) {
        setTestMessage('Temporary super-admin token created.');
      }
      return data.token;
    } catch (requestError) {
      setTestError(requestError.message || 'Unable to connect to the API');
      return null;
    } finally {
      setTestLoading(false);
    }
  };

  const createCompany = async (event) => {
    event.preventDefault();
    setTestLoading(true);
    setTestError('');
    setTestMessage('');

    let activeToken = testToken;
    if (!activeToken) {
      activeToken = await generateDemoToken(false);
    }

    if (!activeToken) {
      setTestError('Unable to create a temporary token. Please try again.');
      setTestLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/super-admin/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify(companyForm),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Unable to create the company');
      }

      setTestMessage(`Company created successfully: ${data.data?.company?.name || companyForm.companyName}`);
      setCompanyForm(initialCompanyForm);
    } catch (requestError) {
      setTestError(requestError.message || 'Unable to create the company');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">React + Express</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>Log in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => changeMode('signup')}>Sign up</button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your name" /></label>}
          <label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" /></label>
          <label>Password<input required type="password" minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 6 characters" /></label>
          <button className="submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
      </section>

      <section className="card">
        <p className="eyebrow">Temporary dashboard</p>
        <h2>Test company creation</h2>
        <p className="helper">This uses the protected /api/super-admin/companies route with a temporary demo token.</p>

        <button className="secondary" onClick={generateDemoToken} disabled={testLoading}>
          {testLoading ? 'Generating…' : 'Generate demo token'}
        </button>

        {testToken && <p className="token">Token: {testToken.slice(0, 24)}…</p>}

        <form onSubmit={createCompany} className="tester-form">
          <label>Company name<input required value={companyForm.companyName} onChange={(event) => setCompanyForm({ ...companyForm, companyName: event.target.value })} placeholder="Acme Ltd" /></label>
          <label>Owner name<input required value={companyForm.ownerName} onChange={(event) => setCompanyForm({ ...companyForm, ownerName: event.target.value })} placeholder="Jane Doe" /></label>
          <label>Email<input required type="email" value={companyForm.email} onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })} placeholder="owner@acme.com" /></label>
          <label>Password<input required type="password" minLength="6" value={companyForm.password} onChange={(event) => setCompanyForm({ ...companyForm, password: event.target.value })} placeholder="At least 6 characters" /></label>
          <label>Phone<input value={companyForm.phone} onChange={(event) => setCompanyForm({ ...companyForm, phone: event.target.value })} placeholder="+1 555 000" /></label>
          <label>Address<input value={companyForm.address} onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })} placeholder="123 Main Street" /></label>
          <label>Industry<input value={companyForm.industry} onChange={(event) => setCompanyForm({ ...companyForm, industry: event.target.value })} placeholder="Software" /></label>
          <label>Website<input value={companyForm.website} onChange={(event) => setCompanyForm({ ...companyForm, website: event.target.value })} placeholder="https://acme.com" /></label>
          <button className="submit" disabled={testLoading}>{testLoading ? 'Please wait…' : 'Create company'}</button>
        </form>

        {testError && <p className="error">{testError}</p>}
        {testMessage && <p className="success">{testMessage}</p>}
      </section>
    </main>
  );
}
