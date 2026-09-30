const { pool } = require('../db');

// Contenido inicial de la página de inicio. Es lo que ve el visitante hasta
// que Marketing publique su primera versión desde el editor del sitio.
// Las imágenes apuntan a fotos que ya viven en /public; al subir fotos desde
// el editor quedan como /api/site-assets/<clave>/<token>.
const DEFAULT_HOME = {
  version: 1,
  whatsapp: {
    number: '59169618264',
    message: 'Hola PCX, quiero cotizar un tablero organizador.'
  },
  nav: [
    { label: 'Inicio', target: 'top' },
    { label: 'Productos', target: 'cotizar' },
    { label: 'Combos', target: 'combos' },
    { label: 'Talleres reales', target: 'galeria' },
    { label: 'Testimonios', target: 'testimonios' },
    { label: 'Ubicaciones', target: 'tiendas' },
    { label: 'Contacto', to: '/contacto' }
  ],
  sections: [
    {
      type: 'hero',
      enabled: true,
      eyebrow: 'Tableros organizadores PCX',
      title: 'Orden, eficiencia y espacio para',
      highlight: 'lo que importa.',
      body: 'Organiza tus herramientas, optimiza tu espacio y trabaja con más comodidad. PCX Acero y PCX Armonía, la solución perfecta para tu hogar, taller u oficina.',
      bullets: [
        { icon: '▦', text: 'Más orden' },
        { icon: '◔', text: 'Mayor productividad' },
        { icon: '⤢', text: 'Espacios aprovechados' }
      ],
      lines: [
        { name: 'ACERO', tagline: 'Para talleres, garajes e industria.', image: '/catalogos/acero-cover.jpg' },
        { name: 'ARMONÍA', tagline: 'Para el hogar, oficinas y espacios creativos.', image: '/catalogos/armonia-cover.jpg' }
      ]
    },
    {
      type: 'facts',
      enabled: true,
      prices: {
        title: 'Precios',
        subtitle: 'Desde Bs 400 hasta Bs 2.000',
        cards: [
          { name: 'PCX Armonía', range: 'Bs 400 – 1.500', image: '/catalogos/armonia-cover.jpg' },
          { name: 'PCX Acero', range: 'Bs 600 – 2.000', image: '/catalogos/acero-cover.jpg' }
        ],
        note: '*Los precios pueden variar según el combo y los accesorios seleccionados.'
      },
      materials: {
        title: 'Materiales',
        items: [
          'Tablero de acero al carbono de 1 mm de espesor.',
          'Accesorios metálicos de alta resistencia.',
          'Acabado con pintura electrostática de larga duración.',
          'Marca PCX en la parte superior.'
        ],
        images: ['/menu-images/RR15N.jpg', '/menu-images/A15N.jpg']
      },
      stores: {
        title: 'Tiendas físicas',
        subtitle: 'Visítanos en nuestras tiendas:',
        items: [
          { city: 'Cochabamba', kind: 'Fábrica + Showroom', address: 'Av. Elías Meneses y Llaunquenquiri, Zona El Paso', maps: 'https://maps.app.goo.gl/HRVW4sFXYWUmFQea8', image: '' },
          { city: 'Santa Cruz', kind: 'Tienda', address: 'Av. Prefecto Rivas y Lagunillas, Zona Alto San Pedro', maps: 'https://maps.app.goo.gl/xtVC8d6JJ2qLwNPY9', image: '' }
        ],
        note_title: 'Envíos a nivel nacional',
        note: 'No tenemos tienda en La Paz, estamos en Cochabamba y Santa Cruz.'
      }
    },
    {
      type: 'combos',
      enabled: true,
      title: 'Combos o compra personalizable',
      subtitle: 'Tú eliges cómo armar tu espacio.',
      items: [
        { name: 'Combo PCX Acero', price: 'Bs 569', desc: 'Tablero 61×95 cm + accesorios', image: '/menu-images/T6195N.jpg' },
        { name: 'Combo PCX Armonía', price: 'Bs 400', desc: 'Tablero 64×64 cm + accesorios', image: '/catalogos/armonia-cover.jpg' }
      ],
      custom: {
        title: 'Compra personalizable',
        body: 'Elige el tablero, el color y los accesorios que necesitas. Crea tu propio combo.',
        cta_label: 'Armar mi pedido',
        cta_to: 'cotizar'
      },
      image: '/menu-images/T9495R.jpg'
    },
    {
      type: 'quote',
      enabled: true,
      title: 'Arma tu pedido',
      subtitle: 'Elige tus productos y envíanos el pedido por WhatsApp. Te confirmamos precio final, envío y forma de pago.',
      show_combos: true,
      cta_label: 'Enviar pedido',
      message_intro: 'Hola PCX, quiero hacer este pedido:',
      note: 'Precios referenciales sin factura. El envío se cotiza según la ciudad.'
    },
    {
      type: 'video',
      enabled: false,
      title: 'Conoce todo sobre PCX',
      badge: 'Video educativo',
      intro: 'En este video te explicamos de forma sencilla:',
      bullets: ['Para qué sirve', 'Qué incluye', 'Cómo se instala', 'Tips de uso y organización'],
      url: '',
      caption: 'Tu taller, más organizado y eficiente'
    },
    {
      type: 'gallery',
      enabled: false,
      title: 'Talleres reales, resultados reales',
      subtitle: 'Así transformamos espacios junto a nuestros clientes.',
      items: []
    },
    {
      type: 'testimonials',
      enabled: true,
      title: 'Lo que dicen nuestros clientes',
      items: [
        { name: 'Carlos Méndez', role: 'Taller automotriz', city: 'Cochabamba', quote: 'El tablero me ayudó a tener todo más a la mano, no pierdo tiempo buscando herramientas. La calidad es excelente.', stars: 5, photo: '' },
        { name: 'Daniela Rojas', role: 'Hogar', city: 'Santa Cruz', quote: 'En casa me cambió la vida, ahora tengo todo organizado y se ve increíble. Los accesorios son muy prácticos.', stars: 5, photo: '' },
        { name: 'Jorge Villarroel', role: 'Mecánico', city: 'Cochabamba', quote: 'Muy buena calidad y resistencia. Lo uso a diario en el taller y sigue como nuevo. Totalmente recomendado.', stars: 5, photo: '' }
      ]
    },
    {
      type: 'closing',
      enabled: true,
      tagline: 'Organiza tu espacio, potencia tu trabajo.',
      perks: [
        { icon: '◈', text: 'Productos de alta calidad' },
        { icon: '⛟', text: 'Envíos a todo el país' },
        { icon: '☎', text: 'Atención personalizada' }
      ],
      cta_title: '¿Listo para transformar tu espacio?',
      cta_label: 'Cotizar por WhatsApp'
    }
  ],
  footer: { text: 'PCX · Hecho en Bolivia · Cochabamba · Santa Cruz' }
};

// Limpieza del contenido que manda el editor: solo texto, números, booleanos,
// listas y objetos; textos acotados; sin claves raras. El diseño no confía
// en nada más que eso (React escapa el texto al renderizar).
const MAX_CONTENT_BYTES = 400 * 1024;
const MAX_TEXT = 4000;
const MAX_DEPTH = 8;

const cleanValue = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === 'string') return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, MAX_TEXT);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => cleanValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-z0-9_]{1,40}$/i.test(key)) continue;
      const cleaned = cleanValue(item, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
};

const sanitizeHomeContent = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const err = new Error('Contenido inválido');
    err.statusCode = 400;
    throw err;
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_CONTENT_BYTES) {
    const err = new Error('El contenido es demasiado grande. Las fotos deben subirse como archivo, no pegarse como texto.');
    err.statusCode = 400;
    throw err;
  }
  const content = cleanValue(raw);
  if (!Array.isArray(content.sections)) {
    const err = new Error('El contenido necesita una lista de secciones');
    err.statusCode = 400;
    throw err;
  }
  content.version = 1;
  return content;
};

// Claves de fotos (/api/site-assets/<clave>/<token>) referenciadas en un JSON.
const collectAssetKeys = (content) => {
  const keys = new Set();
  const text = JSON.stringify(content || {});
  const re = /\/api\/site-assets\/([a-z0-9_-]{1,80})\//g;
  let match;
  while ((match = re.exec(text)) !== null) keys.add(match[1]);
  return keys;
};

// Cuando el código suma una sección nueva (p. ej. el cotizador), el
// contenido ya guardado no la tiene: se agrega con su valor inicial, después
// de la última sección que la precede en el orden de fábrica.
const ensureSections = (content) => {
  if (!content || !Array.isArray(content.sections)) return content;
  const present = new Set(content.sections.map((s) => s?.type));
  const sections = [...content.sections];
  DEFAULT_HOME.sections.forEach((def, defIndex) => {
    if (present.has(def.type)) return;
    const previousTypes = DEFAULT_HOME.sections.slice(0, defIndex).map((s) => s.type);
    let insertAt = 0;
    sections.forEach((s, i) => { if (previousTypes.includes(s?.type)) insertAt = i + 1; });
    sections.splice(insertAt, 0, JSON.parse(JSON.stringify(def)));
  });
  return { ...content, sections };
};

const loadHomeContent = async ({ draft = false } = {}) => {
  const res = await pool.query('SELECT draft, published, published_at, updated_at FROM site_pages WHERE key = $1', ['home']);
  const row = res.rows[0];
  const content = ensureSections((draft ? (row?.draft || row?.published) : row?.published) || DEFAULT_HOME);
  return { content, published_at: row?.published_at || null, updated_at: row?.updated_at || null, is_default: !(draft ? (row?.draft || row?.published) : row?.published) };
};

module.exports = { DEFAULT_HOME, loadHomeContent, ensureSections, sanitizeHomeContent, collectAssetKeys };
