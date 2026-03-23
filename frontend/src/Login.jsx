import { useState } from 'react';
import axios from 'axios';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await axios.post('http://localhost:4000/api/login', { email, password });
      onLogin(res.data.token, res.data.user);
    } catch (_err) {
      setError('Invalid email or password');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px', background: '#1e293b', borderRadius: '10px' }}>
      <h2>Login to PCX Cotizaciones</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ejemplo@sales.com"
            required
            style={{ width: '100%', padding: '10px', marginTop: '5px' }}
          />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', marginTop: '5px' }}
          />
        </div>
        <button type="submit" style={{ width: '100%', padding: '12px', background: '#f87171', color: 'white', border: 'none', borderRadius: '8px' }}>
          Iniciar Sesión
        </button>
      </form>
    </div>
  );
}

export default Login;