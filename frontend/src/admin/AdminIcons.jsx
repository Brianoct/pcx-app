// Íconos de línea del Centro de control (24×24, trazo redondeado). Van en
// línea para heredar el color del grupo vía currentColor.
const PATHS = {
  usuarios: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.3c2.7.2 5 2 5 4.7" />
    </>
  ),
  paneles: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  accesos: (
    <>
      <path d="M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2L12 3.5Z" />
      <path d="m9.2 12 2 2 3.8-4" />
    </>
  ),
  productos: (
    <>
      <path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7l8-4.2Z" />
      <path d="M4.3 8 12 12l7.7-4M12 12v8.2" />
    </>
  ),
  equipos: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  materiales: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  estructura: (
    <>
      <circle cx="12" cy="5.5" r="2.2" />
      <circle cx="6" cy="18.5" r="2.2" />
      <circle cx="18" cy="18.5" r="2.2" />
      <path d="M12 7.7v3.3M12 11 6 16.3M12 11l6 5.3" />
    </>
  ),
  destinos: (
    <>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  programas: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 3.5v3M20.5 12h-3" />
    </>
  ),
  ventas_ia: (
    <>
      <path d="M12 3.5 13.9 9.6 20 11.5l-6.1 1.9L12 19.5l-1.9-6.1L4 11.5l6.1-1.9L12 3.5Z" />
      <path d="M18.5 3.5v3M17 5h3M5.5 17.5v3M4 19h3" />
    </>
  )
};

export default function AdminIcon({ name, size = 22 }) {
  const path = PATHS[name] || PATHS.paneles;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
