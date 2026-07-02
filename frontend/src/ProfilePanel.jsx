import { useMemo, useRef, useState } from 'react';
import { API_BASE, apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';
import { useToast } from './ui/toastContext';

const assetUrl = (path) => {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http') || raw.startsWith('data:')) return raw;
  return `${String(API_BASE || '').replace(/\/+$/, '')}${raw}`;
};

const initialsOf = (name = '', email = '') => {
  const source = String(name || '').trim() || String(email || '').split('@')[0];
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
  reader.readAsDataURL(file);
});

const formatMemberSince = (value) => {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString('es-BO', { year: 'numeric', month: 'long' });
  } catch {
    return null;
  }
};

export default function ProfilePanel({ token, user, onUserUpdated }) {
  const toast = useToast();
  const { enqueueWrite, isOnline } = useOutbox();

  const [form, setForm] = useState({
    display_name: user?.display_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    city: user?.city || '',
    national_id: user?.national_id || '',
    birth_date: user?.birth_date || '',
    emergency_contact_name: user?.emergency_contact_name || '',
    emergency_contact_phone: user?.emergency_contact_phone || '',
    payment_info: user?.payment_info || ''
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const avatarInputRef = useRef(null);
  const qrInputRef = useRef(null);

  const roleLabel = useMemo(() => String(user?.role || 'Usuario'), [user?.role]);
  const memberSince = useMemo(() => formatMemberSince(user?.created_at), [user?.created_at]);
  const avatarSrc = assetUrl(user?.avatar_url);
  const qrSrc = assetUrl(user?.payment_qr_url);

  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const payload = {
        display_name: String(form.display_name || '').trim() || null,
        email: String(form.email || '').trim(),
        phone: form.phone ? String(form.phone).trim() : null,
        city: form.city ? String(form.city).trim() : null,
        national_id: form.national_id ? String(form.national_id).trim() : null,
        birth_date: form.birth_date ? String(form.birth_date).trim() : null,
        emergency_contact_name: form.emergency_contact_name ? String(form.emergency_contact_name).trim() : null,
        emergency_contact_phone: form.emergency_contact_phone ? String(form.emergency_contact_phone).trim() : null,
        payment_info: form.payment_info ? String(form.payment_info).trim() : null
      };
      if (!isOnline) {
        enqueueWrite({
          label: 'Actualizar perfil',
          path: '/api/me',
          options: { method: 'PATCH', token, body: payload, retries: 0 },
          meta: { type: 'profile_update', email: payload.email }
        });
        if (typeof onUserUpdated === 'function') onUserUpdated({ ...user, ...payload });
        toast.info('Sin conexión: actualización de perfil en cola.');
        return;
      }
      const data = await apiRequest('/api/me', { method: 'PATCH', token, body: payload, retries: 0 });
      if (data?.user && typeof onUserUpdated === 'function') onUserUpdated(data.user);
      toast.success('Perfil actualizado correctamente');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo actualizar el perfil'));
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadAsset = async (kind, file) => {
    if (!file) return;
    if (!isOnline) {
      toast.error('Necesitas conexión para subir imágenes.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen supera 5MB. Usa una más liviana.');
      return;
    }
    setUploading(kind);
    try {
      const dataUrl = await fileToDataUrl(file);
      const data = await apiRequest('/api/me/asset', {
        method: 'POST',
        token,
        body: { kind, data_url: dataUrl },
        retries: 0
      });
      if (data?.user && typeof onUserUpdated === 'function') onUserUpdated(data.user);
      toast.success(kind === 'qr' ? 'QR de pago actualizado' : 'Foto actualizada');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo subir la imagen'));
    } finally {
      setUploading('');
    }
  };

  const clearAsset = async (kind) => {
    if (!isOnline) {
      toast.error('Necesitas conexión para eliminar imágenes.');
      return;
    }
    setUploading(kind);
    try {
      const data = await apiRequest('/api/me/asset', {
        method: 'POST',
        token,
        body: { kind, clear: true },
        retries: 0
      });
      if (data?.user && typeof onUserUpdated === 'function') onUserUpdated(data.user);
      toast.success('Imagen eliminada');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo eliminar la imagen'));
    } finally {
      setUploading('');
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error('Completa contraseña actual y nueva contraseña');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('La confirmación no coincide con la nueva contraseña');
      return;
    }
    setSavingPassword(true);
    try {
      const body = {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      };
      if (!isOnline) {
        enqueueWrite({
          label: 'Cambiar contraseña',
          path: '/api/me/password',
          options: { method: 'PATCH', token, body, retries: 0 },
          meta: { type: 'password_change' }
        });
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        toast.info('Sin conexión: cambio de contraseña en cola.');
        return;
      }
      await apiRequest('/api/me/password', { method: 'PATCH', token, body, retries: 0 });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      toast.success('Contraseña actualizada correctamente');
    } catch (err) {
      toast.error('Error: ' + (err.message || 'No se pudo actualizar la contraseña'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="container profile-page">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#dc2626' }}>Perfil</h2>

      {/* Hero: avatar + identity */}
      <div className="card profile-hero">
        <div className="profile-avatar-wrap">
          <div className="profile-avatar">
            {avatarSrc
              ? <img src={avatarSrc} alt="Foto de perfil" />
              : <span className="profile-avatar-initials">{initialsOf(user?.display_name, user?.email)}</span>}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => { uploadAsset('avatar', e.target.files?.[0]); e.target.value = ''; }}
          />
          <button
            type="button"
            className="profile-avatar-edit"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploading === 'avatar'}
            aria-label="Cambiar foto"
            title="Cambiar foto"
          >
            {uploading === 'avatar' ? '…' : '✎'}
          </button>
        </div>
        <div className="profile-hero-info">
          <div className="profile-hero-name">{user?.display_name || user?.email || 'Usuario'}</div>
          <div className="profile-hero-meta">
            <span className="ui-chip">{roleLabel}</span>
            {memberSince && <span className="profile-hero-since">Miembro desde {memberSince}</span>}
          </div>
          {avatarSrc && (
            <button
              type="button"
              className="profile-linkbtn"
              onClick={() => clearAsset('avatar')}
              disabled={uploading === 'avatar'}
            >
              Quitar foto
            </button>
          )}
        </div>
      </div>

      <form onSubmit={saveProfile}>
        {/* Datos personales */}
        <div className="card">
          <h3 className="profile-section-title">Datos personales</h3>
          <div className="quote-edit-grid">
            <label>
              Nombre visible
              <input type="text" value={form.display_name} onChange={setField('display_name')} placeholder="Ej: Willy" />
            </label>
            <label>
              Carnet de Identidad (CI)
              <input type="text" value={form.national_id} onChange={setField('national_id')} placeholder="Ej: 7654321 CB" />
            </label>
            <label>
              Fecha de nacimiento
              <input type="date" value={form.birth_date || ''} onChange={setField('birth_date')} />
            </label>
            <label>
              Ciudad
              <input type="text" value={form.city} onChange={setField('city')} placeholder="Ej: Santa Cruz" />
            </label>
          </div>
        </div>

        {/* Contacto */}
        <div className="card">
          <h3 className="profile-section-title">Contacto</h3>
          <div className="quote-edit-grid">
            <label>
              Correo
              <input type="email" value={form.email} onChange={setField('email')} required />
            </label>
            <label>
              Teléfono (8 dígitos)
              <input type="text" value={form.phone} onChange={setField('phone')} placeholder="Ej: 77778888" />
            </label>
            <label>
              Contacto de emergencia
              <input type="text" value={form.emergency_contact_name} onChange={setField('emergency_contact_name')} placeholder="Nombre" />
            </label>
            <label>
              Teléfono de emergencia
              <input type="text" value={form.emergency_contact_phone} onChange={setField('emergency_contact_phone')} placeholder="Ej: 77778888" />
            </label>
          </div>
        </div>

        {/* Pago — highlighted */}
        <div className="card profile-pay-card">
          <h3 className="profile-section-title">Pago de fin de mes</h3>
          <p className="profile-pay-hint">
            Sube tu QR de pago y datos de tu cuenta para que Administración pueda pagarte sin demoras.
          </p>
          <div className="profile-pay-grid">
            <div className="profile-qr-box">
              {qrSrc ? (
                <img src={qrSrc} alt="QR de pago" className="profile-qr-img" />
              ) : (
                <div className="profile-qr-empty">Sin QR cargado</div>
              )}
              <input
                ref={qrInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => { uploadAsset('qr', e.target.files?.[0]); e.target.value = ''; }}
              />
              <div className="profile-qr-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => qrInputRef.current?.click()}
                  disabled={uploading === 'qr'}
                >
                  {uploading === 'qr' ? 'Subiendo…' : (qrSrc ? 'Cambiar QR' : 'Subir QR')}
                </button>
                {qrSrc && (
                  <button
                    type="button"
                    className="profile-linkbtn"
                    onClick={() => clearAsset('qr')}
                    disabled={uploading === 'qr'}
                  >
                    Quitar
                  </button>
                )}
              </div>
            </div>
            <label className="profile-pay-info">
              Datos de la cuenta / alias
              <textarea
                rows={4}
                value={form.payment_info}
                onChange={setField('payment_info')}
                placeholder={'Ej: Banco Unión\nCuenta: 10000012345\nTitular: Willy Huanca'}
              />
            </label>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Guardando...' : 'Guardar perfil'}
          </button>
        </div>
      </form>

      {/* Seguridad */}
      <div className="card">
        <h3 className="profile-section-title">Cambiar contraseña</h3>
        <form onSubmit={savePassword} className="quote-edit-grid">
          <label>
            Contraseña actual
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </label>
          <label>
            Nueva contraseña (mín. 6)
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} required />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Confirmar nueva contraseña
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required />
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
