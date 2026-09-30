// Editor del sitio público (Marketing / Admin): a la izquierda los textos y
// fotos de cada sección, a la derecha la página tal como la verá el visitante.
// Cada cambio se guarda solo como borrador; «Publicar» lo hace visible en
// pcxind.com. El diseño (colores, grilla) no se edita aquí: solo contenido.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from './apiClient';
import { LandingContent } from './LandingPage';
import { imageSrc, videoEmbedUrl } from './siteMedia';
import { useToast } from './ui/toastContext';

// Fotos: se reducen en el navegador antes de subir (máx. 1600 px de lado,
// WebP cuando el navegador puede), así una foto de celular de 4 MB pesa
// ~150 KB en la base.
const downscaleImage = (file, { maxDim = 1600, quality = 0.82 } = {}) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const webp = canvas.toDataURL('image/webp', quality);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = String(reader.result || '');
  };
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

const SECTION_LABELS = {
  hero: 'Portada',
  facts: 'Precios · Materiales · Tiendas',
  combos: 'Combos y compra personalizable',
  quote: 'Arma tu pedido (cotizador)',
  video: 'Video educativo',
  gallery: 'Talleres reales (antes / después)',
  testimonials: 'Testimonios',
  closing: 'Cierre y WhatsApp'
};

const NAV_TARGETS = [
  { value: 'top', label: 'Arriba de todo' },
  { value: 'cotizar', label: 'Arma tu pedido (cotizador)' },
  { value: 'combos', label: 'Combos' },
  { value: 'tiendas', label: 'Tiendas físicas' },
  { value: 'video', label: 'Video' },
  { value: 'galeria', label: 'Talleres reales' },
  { value: 'testimonios', label: 'Testimonios' },
  { value: '/catalogos', label: 'Página de catálogos' },
  { value: '/contacto', label: 'Página de contacto' },
  { value: '/carreras', label: 'Trabaja con nosotros' }
];

const setPath = (obj, path, value) => {
  const next = Array.isArray(obj) ? [...obj] : { ...obj };
  const [head, ...rest] = path;
  next[head] = rest.length === 0 ? value : setPath(next[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value);
  return next;
};

// ─── Campos ─────────────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <label className="se-field">
      <span className="se-label">{label}{hint && <small>{hint}</small>}</span>
      {children}
    </label>
  );
}

function TextField({ label, value, onChange, hint, multiline = false, type = 'text', placeholder }) {
  return (
    <Field label={label} hint={hint}>
      {multiline
        ? <textarea className="form-textarea" rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className="form-input" type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} />}
    </Field>
  );
}

function ImageField({ label, value, onChange, token, hint }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await downscaleImage(file);
      const result = await apiRequest('/api/site-assets', { method: 'POST', token, body: { data_url: dataUrl } });
      onChange(result.url);
      toast.success(`Foto subida (${Math.round((result.bytes || 0) / 1024)} KB)`);
    } catch (err) {
      toast.error(err.message || 'No se pudo subir la foto');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const src = imageSrc(value);
  return (
    <div className="se-field">
      <span className="se-label">{label}{hint && <small>{hint}</small>}</span>
      <div className="se-image">
        <div className="se-image-thumb">{src ? <img src={src} alt="" /> : <span>Sin foto</span>}</div>
        <div className="se-image-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Subiendo…' : (src ? 'Cambiar foto' : 'Subir foto')}
          </button>
          {src && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>Quitar</button>}
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select className="form-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </Field>
  );
}

// Lista de elementos (bullets, combos, testimonios…) con agregar / quitar /
// mover. `fields` describe cada elemento; si es null, el elemento es un texto.
function ListEditor({ label, items, onChange, fields, newItem, token, addLabel = 'Agregar', max = 12 }) {
  const list = Array.isArray(items) ? items : [];
  const update = (index, value) => onChange(list.map((item, i) => (i === index ? value : item)));
  const remove = (index) => onChange(list.filter((_, i) => i !== index));
  const move = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="se-list">
      <div className="se-list-head">
        <span className="se-label">{label}</span>
        {list.length < max && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...list, typeof newItem === 'function' ? newItem() : newItem])}>+ {addLabel}</button>
        )}
      </div>
      {list.length === 0 && <p className="se-empty">Nada todavía.</p>}
      {list.map((item, index) => (
        <div key={index} className="se-list-item">
          <div className="se-list-tools">
            <span className="se-list-index">{index + 1}</span>
            <button type="button" title="Subir" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
            <button type="button" title="Bajar" disabled={index === list.length - 1} onClick={() => move(index, 1)}>↓</button>
            <button type="button" title="Quitar" className="is-danger" onClick={() => remove(index)}>×</button>
          </div>
          {fields === null ? (
            <input className="form-input" value={item ?? ''} onChange={(e) => update(index, e.target.value)} />
          ) : (
            <div className="se-list-fields">
              {fields.map((field) => {
                const value = item?.[field.key];
                const set = (v) => update(index, { ...item, [field.key]: v });
                if (field.type === 'image') return <ImageField key={field.key} label={field.label} value={value} onChange={set} token={token} />;
                if (field.type === 'select') return <SelectField key={field.key} label={field.label} value={value} onChange={set} options={field.options} />;
                return <TextField key={field.key} label={field.label} value={value} onChange={set} multiline={field.type === 'textarea'} type={field.type === 'number' ? 'number' : 'text'} hint={field.hint} placeholder={field.placeholder} />;
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Editores por sección ───────────────────────────────────────────────────

const ICON_HINT = 'un símbolo o emoji';

function HeroEditor({ section, set, token }) {
  return (
    <>
      <TextField label="Texto pequeño arriba" value={section.eyebrow} onChange={(v) => set(['eyebrow'], v)} />
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <TextField label="Parte del título en rojo" value={section.highlight} onChange={(v) => set(['highlight'], v)} />
      <TextField label="Descripción" value={section.body} onChange={(v) => set(['body'], v)} multiline />
      <ListEditor label="Beneficios" items={section.bullets} onChange={(v) => set(['bullets'], v)} token={token} max={4}
        fields={[{ key: 'icon', label: 'Ícono', hint: ICON_HINT }, { key: 'text', label: 'Texto' }]} newItem={{ icon: '✓', text: '' }} />
      <ListEditor label="Líneas de producto" items={section.lines} onChange={(v) => set(['lines'], v)} token={token} max={3} addLabel="Línea"
        fields={[{ key: 'name', label: 'Nombre' }, { key: 'tagline', label: 'Frase' }, { key: 'image', label: 'Foto', type: 'image' }]}
        newItem={{ name: '', tagline: '', image: '' }} />
    </>
  );
}

function FactsEditor({ section, set, token }) {
  const prices = section.prices || {};
  const materials = section.materials || {};
  const stores = section.stores || {};
  return (
    <>
      <h4 className="se-subhead">Precios</h4>
      <TextField label="Título" value={prices.title} onChange={(v) => set(['prices', 'title'], v)} />
      <TextField label="Subtítulo" value={prices.subtitle} onChange={(v) => set(['prices', 'subtitle'], v)} />
      <ListEditor label="Tarjetas de precio" items={prices.cards} onChange={(v) => set(['prices', 'cards'], v)} token={token} max={4} addLabel="Tarjeta"
        fields={[{ key: 'name', label: 'Nombre' }, { key: 'range', label: 'Rango de precio' }, { key: 'image', label: 'Foto', type: 'image' }]}
        newItem={{ name: '', range: '', image: '' }} />
      <TextField label="Nota" value={prices.note} onChange={(v) => set(['prices', 'note'], v)} />

      <h4 className="se-subhead">Materiales</h4>
      <TextField label="Título" value={materials.title} onChange={(v) => set(['materials', 'title'], v)} />
      <ListEditor label="Puntos" items={materials.items} onChange={(v) => set(['materials', 'items'], v)} fields={null} newItem="" max={8} addLabel="Punto" />
      <ImageField label="Foto 1" value={materials.images?.[0]} onChange={(v) => set(['materials', 'images', 0], v)} token={token} />
      <ImageField label="Foto 2" value={materials.images?.[1]} onChange={(v) => set(['materials', 'images', 1], v)} token={token} />

      <h4 className="se-subhead">Tiendas físicas</h4>
      <TextField label="Título" value={stores.title} onChange={(v) => set(['stores', 'title'], v)} />
      <TextField label="Subtítulo" value={stores.subtitle} onChange={(v) => set(['stores', 'subtitle'], v)} />
      <ListEditor label="Tiendas" items={stores.items} onChange={(v) => set(['stores', 'items'], v)} token={token} max={5} addLabel="Tienda"
        fields={[{ key: 'city', label: 'Ciudad' }, { key: 'kind', label: 'Tipo (fábrica, tienda…)' }, { key: 'address', label: 'Dirección' }, { key: 'image', label: 'Foto', type: 'image' }]}
        newItem={{ city: '', kind: '', address: '', image: '' }} />
      <TextField label="Título de la nota" value={stores.note_title} onChange={(v) => set(['stores', 'note_title'], v)} />
      <TextField label="Nota" value={stores.note} onChange={(v) => set(['stores', 'note'], v)} />
    </>
  );
}

function CombosEditor({ section, set, token }) {
  const custom = section.custom || {};
  return (
    <>
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <TextField label="Subtítulo" value={section.subtitle} onChange={(v) => set(['subtitle'], v)} />
      <ListEditor label="Combos" items={section.items} onChange={(v) => set(['items'], v)} token={token} max={6} addLabel="Combo"
        fields={[{ key: 'name', label: 'Nombre' }, { key: 'desc', label: 'Qué incluye' }, { key: 'price', label: 'Precio', placeholder: 'Bs 569' }, { key: 'image', label: 'Foto', type: 'image' }]}
        newItem={{ name: '', desc: '', price: '', image: '' }} />
      <h4 className="se-subhead">Compra personalizable</h4>
      <TextField label="Título" value={custom.title} onChange={(v) => set(['custom', 'title'], v)} />
      <TextField label="Texto" value={custom.body} onChange={(v) => set(['custom', 'body'], v)} multiline />
      <TextField label="Botón" value={custom.cta_label} onChange={(v) => set(['custom', 'cta_label'], v)} />
      <SelectField label="El botón lleva a" value={custom.cta_to || 'cotizar'} onChange={(v) => set(['custom', 'cta_to'], v)}
        options={NAV_TARGETS.filter((t) => t.value !== 'top')} />
      <ImageField label="Foto de fondo" value={section.image} onChange={(v) => set(['image'], v)} token={token} />
    </>
  );
}

function QuoteEditor({ section, set }) {
  return (
    <>
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <TextField label="Subtítulo" value={section.subtitle} onChange={(v) => set(['subtitle'], v)} multiline />
      <label className="se-check">
        <input type="checkbox" checked={section.show_combos !== false} onChange={(e) => set(['show_combos'], e.target.checked)} />
        <span>Mostrar también los combos</span>
      </label>
      <TextField label="Botón de envío" value={section.cta_label} onChange={(v) => set(['cta_label'], v)} />
      <TextField label="Primera línea del mensaje de WhatsApp" value={section.message_intro} onChange={(v) => set(['message_intro'], v)} hint="después va la lista de productos y el total" />
      <TextField label="Nota bajo los productos" value={section.note} onChange={(v) => set(['note'], v)} />
      <p className="se-empty">Los productos, fotos y precios son los mismos de Cotizar (Admin › Productos). Aquí solo se edita el texto.</p>
    </>
  );
}

function VideoEditor({ section, set }) {
  const embed = videoEmbedUrl(section.url);
  return (
    <>
      <TextField label="Enlace del video" value={section.url} onChange={(v) => set(['url'], v)} placeholder="https://www.youtube.com/watch?v=…"
        hint={section.url && !embed ? 'Solo YouTube o TikTok' : 'YouTube o TikTok; la sección se muestra solo con enlace válido'} />
      <TextField label="Etiqueta" value={section.badge} onChange={(v) => set(['badge'], v)} />
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <TextField label="Introducción" value={section.intro} onChange={(v) => set(['intro'], v)} />
      <ListEditor label="Qué explica el video" items={section.bullets} onChange={(v) => set(['bullets'], v)} fields={null} newItem="" max={6} addLabel="Punto" />
      <TextField label="Frase debajo del video" value={section.caption} onChange={(v) => set(['caption'], v)} />
    </>
  );
}

function GalleryEditor({ section, set, token }) {
  return (
    <>
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <TextField label="Subtítulo" value={section.subtitle} onChange={(v) => set(['subtitle'], v)} />
      <ListEditor label="Talleres" items={section.items} onChange={(v) => set(['items'], v)} token={token} max={12} addLabel="Taller"
        fields={[{ key: 'before', label: 'Antes', type: 'image' }, { key: 'after', label: 'Después', type: 'image' }, { key: 'caption', label: 'Pie de foto' }]}
        newItem={{ before: '', after: '', caption: '' }} />
      <p className="se-empty">Con una sola foto (antes o después) se muestra esa foto sola. La sección aparece cuando hay al menos un taller.</p>
    </>
  );
}

function TestimonialsEditor({ section, set, token }) {
  return (
    <>
      <TextField label="Título" value={section.title} onChange={(v) => set(['title'], v)} />
      <ListEditor label="Testimonios" items={section.items} onChange={(v) => set(['items'], v)} token={token} max={9} addLabel="Testimonio"
        fields={[{ key: 'quote', label: 'Comentario', type: 'textarea' }, { key: 'name', label: 'Nombre' }, { key: 'role', label: 'Ocupación / uso' }, { key: 'city', label: 'Ciudad' }, { key: 'stars', label: 'Estrellas (1 a 5)', type: 'number' }, { key: 'photo', label: 'Foto', type: 'image' }]}
        newItem={{ quote: '', name: '', role: '', city: '', stars: 5, photo: '' }} />
    </>
  );
}

function ClosingEditor({ section, set, token }) {
  return (
    <>
      <TextField label="Frase" value={section.tagline} onChange={(v) => set(['tagline'], v)} />
      <ListEditor label="Ventajas" items={section.perks} onChange={(v) => set(['perks'], v)} token={token} max={4}
        fields={[{ key: 'icon', label: 'Ícono', hint: ICON_HINT }, { key: 'text', label: 'Texto' }]} newItem={{ icon: '✓', text: '' }} />
      <TextField label="Pregunta final" value={section.cta_title} onChange={(v) => set(['cta_title'], v)} />
      <TextField label="Botón" value={section.cta_label} onChange={(v) => set(['cta_label'], v)} />
    </>
  );
}

const SECTION_EDITORS = {
  hero: HeroEditor,
  facts: FactsEditor,
  combos: CombosEditor,
  quote: QuoteEditor,
  video: VideoEditor,
  gallery: GalleryEditor,
  testimonials: TestimonialsEditor,
  closing: ClosingEditor
};

function GeneralEditor({ content, set }) {
  const nav = Array.isArray(content.nav) ? content.nav : [];
  const navValue = (link) => (link.to ? link.to : (link.target || 'top'));
  const setNav = (list) => set(['nav'], list.map((link) => {
    const value = link.value ?? navValue(link);
    return value.startsWith('/') ? { label: link.label, to: value } : { label: link.label, target: value };
  }));
  return (
    <>
      <TextField label="Número de WhatsApp" value={content.whatsapp?.number} onChange={(v) => set(['whatsapp', 'number'], v)} hint="con código de país, sin +" />
      <TextField label="Mensaje inicial de WhatsApp" value={content.whatsapp?.message} onChange={(v) => set(['whatsapp', 'message'], v)} multiline />
      <ListEditor label="Menú de arriba" items={nav.map((link) => ({ label: link.label, value: navValue(link) }))} onChange={setNav} max={7} addLabel="Enlace"
        fields={[{ key: 'label', label: 'Texto' }, { key: 'value', label: 'Lleva a', type: 'select', options: NAV_TARGETS }]}
        newItem={{ label: '', value: 'top' }} />
      <TextField label="Pie de página" value={content.footer?.text} onChange={(v) => set(['footer', 'text'], v)} />
    </>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function SiteEditor({ token }) {
  const toast = useToast();
  const [draft, setDraft] = useState(null);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error
  const [publishing, setPublishing] = useState(false);
  const [openKey, setOpenKey] = useState('general');
  const [device, setDevice] = useState('desktop');
  const lastSavedRef = useRef('');
  const draftRef = useRef(null);
  const previewRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    apiRequest('/api/site/home/editor', { token })
      .then((data) => {
        setDraft(data.draft);
        lastSavedRef.current = JSON.stringify(data.draft);
        setMeta(data);
      })
      .catch((err) => setError(err.message || 'No se pudo cargar el editor'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  // Autoguardado del borrador 1,2 s después del último cambio.
  useEffect(() => {
    if (!draft) return undefined;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedRef.current) return undefined;
    setSaveState('dirty');
    const timer = setTimeout(async () => {
      setSaveState('saving');
      try {
        const data = await apiRequest('/api/site/home/draft', { method: 'PUT', token, body: { content: draft } });
        lastSavedRef.current = serialized;
        setMeta(data);
        setSaveState(JSON.stringify(draftRef.current) === serialized ? 'saved' : 'dirty');
      } catch (err) {
        setSaveState('error');
        toast.error(err.message || 'No se pudo guardar el borrador');
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [draft, token, toast]);

  // La vista previa se dibuja al ancho real (escritorio 1280 / celular 390)
  // y se escala para caber en la columna.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return undefined;
    const width = device === 'mobile' ? 390 : 1280;
    const compute = () => setPreviewScale(Math.min(1, el.clientWidth / width));
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [device, loading]);

  const set = useCallback((path, value) => setDraft((prev) => setPath(prev, path, value)), []);
  const setSection = useCallback((index, path, value) => setDraft((prev) => setPath(prev, ['sections', index, ...path], value)), []);

  const moveSection = (index, dir) => {
    setDraft((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.sections.length) return prev;
      const sections = [...prev.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...prev, sections };
    });
  };

  const publish = async () => {
    if (!draft) return;
    setPublishing(true);
    try {
      const data = await apiRequest('/api/site/home/publish', { method: 'POST', token, body: { content: draft } });
      lastSavedRef.current = JSON.stringify(draft);
      setMeta(data);
      setSaveState('saved');
      toast.success('Publicado: ya se ve en pcxind.com');
    } catch (err) {
      toast.error(err.message || 'No se pudo publicar');
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    if (!meta.published) { toast.info('Todavía no hay una versión publicada'); return; }
    if (!window.confirm('¿Descartar los cambios sin publicar y volver a lo publicado?')) return;
    try {
      const data = await apiRequest('/api/site/home/discard', { method: 'POST', token });
      setDraft(data.draft);
      lastSavedRef.current = JSON.stringify(data.draft);
      setMeta(data);
      setSaveState('saved');
    } catch (err) {
      toast.error(err.message || 'No se pudo descartar');
    }
  };

  const reset = async () => {
    if (!window.confirm('¿Volver al contenido inicial? Queda como borrador; lo publicado no cambia hasta que publiques.')) return;
    try {
      const data = await apiRequest('/api/site/home/reset', { method: 'POST', token });
      setDraft(data.draft);
      lastSavedRef.current = JSON.stringify(data.draft);
      setMeta(data);
      setSaveState('saved');
    } catch (err) {
      toast.error(err.message || 'No se pudo restaurar');
    }
  };

  const hasUnpublished = useMemo(() => {
    if (!draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(meta.published || null);
  }, [draft, meta.published]);

  if (loading) return <div className="container"><p className="se-empty">Cargando el editor…</p></div>;
  if (error || !draft) return <div className="container"><div className="camp-error">{error || 'Sin contenido'}</div></div>;

  const saveLabel = { saved: 'Borrador guardado', dirty: 'Cambios sin guardar…', saving: 'Guardando…', error: 'No se pudo guardar' }[saveState];
  const previewWidth = device === 'mobile' ? 390 : 1280;

  return (
    <div className="site-editor">
      <div className="se-toolbar">
        <div className="se-status">
          <strong>Sitio web · Inicio</strong>
          <span className={`se-save-state is-${saveState}`}>{saveLabel}</span>
          <span className="se-meta">
            {meta.published_at ? `Publicado ${formatDate(meta.published_at)}` : 'Nunca publicado (se ve el contenido inicial)'}
            {meta.updated_by_name ? ` · último cambio: ${meta.updated_by_name}` : ''}
          </span>
        </div>
        <div className="se-actions">
          <div className="se-device">
            <button type="button" className={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')}>Escritorio</button>
            <button type="button" className={device === 'mobile' ? 'is-on' : ''} onClick={() => setDevice('mobile')}>Celular</button>
          </div>
          <a className="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener noreferrer">Ver sitio</a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Contenido inicial</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={discard} disabled={!hasUnpublished}>Descartar cambios</button>
          <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing || !hasUnpublished}>
            {publishing ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </div>

      <div className="se-body">
        <aside className="se-form">
          <details className="se-section" open={openKey === 'general'} onToggle={(e) => { if (e.target.open) setOpenKey('general'); }}>
            <summary><span>General</span><small>WhatsApp · menú · pie</small></summary>
            <div className="se-section-body"><GeneralEditor content={draft} set={set} /></div>
          </details>

          {draft.sections.map((section, index) => {
            const Editor = SECTION_EDITORS[section.type];
            const key = `${section.type}-${index}`;
            return (
              <details key={key} className={`se-section ${section.enabled === false ? 'is-off' : ''}`} open={openKey === key} onToggle={(e) => { if (e.target.open) setOpenKey(key); }}>
                <summary>
                  <span>{SECTION_LABELS[section.type] || section.type}</span>
                  <span className="se-section-tools" onClick={(e) => e.preventDefault()}>
                    <button type="button" title="Subir" disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button>
                    <button type="button" title="Bajar" disabled={index === draft.sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button>
                    <label className="se-toggle" title="Mostrar en el sitio">
                      <input type="checkbox" checked={section.enabled !== false} onChange={(e) => setSection(index, ['enabled'], e.target.checked)} />
                      <span>{section.enabled !== false ? 'Visible' : 'Oculta'}</span>
                    </label>
                  </span>
                </summary>
                <div className="se-section-body">
                  {Editor ? <Editor section={section} set={(path, value) => setSection(index, path, value)} token={token} /> : <p className="se-empty">Sección sin editor.</p>}
                </div>
              </details>
            );
          })}
        </aside>

        <div className="se-preview" ref={previewRef}>
          <div className="se-preview-stage" style={{ width: previewWidth, zoom: previewScale }}>
            <div className="se-preview-page" onClickCapture={(e) => { const a = e.target.closest('a'); if (a) e.preventDefault(); }}>
              <LandingContent content={draft} preview />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
