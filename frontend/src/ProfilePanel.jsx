import { useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

export default function ProfilePanel({ token, user, onUserUpdated }) {
  const [email, setEmail] = useState(user?.email || '');
  const [city, setCity] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const roleLabel = useMemo(() => String(user?.role || 'Usuario'), [user?.role]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const payload = {
        email: String(email || '').trim(),
        city: city ? String(city).trim() : null,
        phone: phone ? String(phone).trim() : null
      };
      const data = await apiRequest('/api/me', {
        method: 'PATCH',
        token,
        body: payload,
        retries: 0
      });

      if (data?.user && typeof onUserUpdated === 'function') {
        onUserUpdated(data.user);
      }
      alert('Perfil actualizado correctamente');
    } catch (err) {
      alert('Error: ' + (err.message || 'No se pudo actualizar el perfil'));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      alert('Completa contraseña actual y nueva contraseña');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('La confirmación no coincide con la nueva contraseña');
      return;
    }

    setSavingPassword(true);
    try {
      await apiRequest('/api/me/password', {
        method: 'PATCH',
        token,
        body: {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword
        },
        retries: 0
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Contraseña actualizada correctamente');
    } catch (err) {
      alert('Error: ' + (err.message || 'No se pudo actualizar la contraseña'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>Perfil</h2>

      <div className="card">
        <h3 style={{ marginBottom: '12px' }}>Datos de usuario</h3>
        <div style={{ color: '#94a3b8', marginBottom: '12px' }}>
          Rol actual: <strong style={{ color: '#e2e8f0' }}>{roleLabel}</strong>
        </div>

        <form onSubmit={saveProfile} className="quote-edit-grid">
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Teléfono (8 dígitos)
            <input
              type="text"
              value={phone || ''}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 77778888"
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Ciudad
            <input
              type="text"
              value={city || ''}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Ej: Santa Cruz"
            />
          </label>

          <div className="quote-edit-actions" style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Guardando...' : 'Guardar perfil'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '12px' }}>Cambiar contraseña</h3>
        <form onSubmit={savePassword} className="quote-edit-grid">
          <label>
            Contraseña actual
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Nueva contraseña (mín. 6)
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Confirmar nueva contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          <div className="quote-edit-actions" style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
            <button type="submit" className="btn btn-primary" disabled={savingPassword}>
              {savingPassword ? 'Actualizando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
