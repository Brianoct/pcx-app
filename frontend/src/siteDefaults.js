// Generado desde backend/lib/site.js (DEFAULT_HOME): contenido inicial del
// inicio público, usado mientras carga /api/site/home o si la API falla.
// Para cambiar el contenido inicial, editar el backend y volver a generar:
//   cd backend && node scripts/exportSiteDefaults.js
export const DEFAULT_HOME = {
  "version": 1,
  "whatsapp": {
    "number": "59169618264",
    "message": "Hola PCX, quiero cotizar un tablero organizador."
  },
  "nav": [
    {
      "label": "Inicio",
      "target": "top"
    },
    {
      "label": "Productos",
      "target": "combos"
    },
    {
      "label": "Talleres reales",
      "target": "galeria"
    },
    {
      "label": "Testimonios",
      "target": "testimonios"
    },
    {
      "label": "Ubicaciones",
      "target": "tiendas"
    },
    {
      "label": "Contacto",
      "to": "/contacto"
    }
  ],
  "sections": [
    {
      "type": "hero",
      "enabled": true,
      "eyebrow": "Tableros organizadores PCX",
      "title": "Orden, eficiencia y espacio para",
      "highlight": "lo que importa.",
      "body": "Organiza tus herramientas, optimiza tu espacio y trabaja con más comodidad. PCX Acero y PCX Armonía, la solución perfecta para tu hogar, taller u oficina.",
      "bullets": [
        {
          "icon": "▦",
          "text": "Más orden"
        },
        {
          "icon": "◔",
          "text": "Mayor productividad"
        },
        {
          "icon": "⤢",
          "text": "Espacios aprovechados"
        }
      ],
      "lines": [
        {
          "name": "ACERO",
          "tagline": "Para talleres, garajes e industria.",
          "image": "/catalogos/acero-cover.jpg"
        },
        {
          "name": "ARMONÍA",
          "tagline": "Para el hogar, oficinas y espacios creativos.",
          "image": "/catalogos/armonia-cover.jpg"
        }
      ]
    },
    {
      "type": "facts",
      "enabled": true,
      "image": "/menu-images/T9495N.jpg",
      "prices": {
        "title": "Precios",
        "subtitle": "Desde Bs 400 hasta Bs 2.000",
        "cards": [
          {
            "name": "PCX Armonía",
            "range": "Bs 400 – 1.500",
            "image": "/catalogos/armonia-cover.jpg"
          },
          {
            "name": "PCX Acero",
            "range": "Bs 600 – 2.000",
            "image": "/catalogos/acero-cover.jpg"
          }
        ],
        "note": "*Los precios pueden variar según el combo y los accesorios seleccionados."
      },
      "materials": {
        "title": "Materiales",
        "items": [
          "Tablero de acero al carbono de 1 mm de espesor.",
          "Accesorios metálicos de alta resistencia.",
          "Acabado con pintura electrostática de larga duración.",
          "Marca PCX en la parte superior."
        ],
        "images": [
          "/menu-images/RR15N.jpg",
          "/menu-images/A15N.jpg"
        ]
      },
      "stores": {
        "title": "Tiendas físicas",
        "subtitle": "Visítanos en nuestras tiendas:",
        "items": [
          {
            "city": "Cochabamba",
            "kind": "Fábrica + Showroom",
            "address": "Av. Elías Meneses y Llaunquenquiri, Zona El Paso",
            "image": ""
          },
          {
            "city": "Santa Cruz",
            "kind": "Tienda",
            "address": "Av. Prefecto Rivas y Lagunillas, Zona Alto San Pedro",
            "image": ""
          }
        ],
        "note_title": "Envíos a nivel nacional",
        "note": "No tenemos tienda en La Paz, estamos en Cochabamba y Santa Cruz."
      }
    },
    {
      "type": "combos",
      "enabled": true,
      "title": "Combos o compra personalizable",
      "subtitle": "Tú eliges cómo armar tu espacio.",
      "items": [
        {
          "name": "Combo PCX Acero",
          "price": "Bs 569",
          "desc": "Tablero 61×95 cm + accesorios",
          "image": "/menu-images/T6195N.jpg"
        },
        {
          "name": "Combo PCX Armonía",
          "price": "Bs 400",
          "desc": "Tablero 64×64 cm + accesorios",
          "image": "/catalogos/armonia-cover.jpg"
        }
      ],
      "custom": {
        "title": "Compra personalizable",
        "body": "Elige el tablero, el color y los accesorios que necesitas. Crea tu propio combo.",
        "cta_label": "Ver catálogo completo",
        "cta_to": "/catalogos"
      },
      "image": "/menu-images/T9495R.jpg"
    },
    {
      "type": "video",
      "enabled": false,
      "title": "Conoce todo sobre PCX",
      "badge": "Video educativo",
      "intro": "En este video te explicamos de forma sencilla:",
      "bullets": [
        "Para qué sirve",
        "Qué incluye",
        "Cómo se instala",
        "Tips de uso y organización"
      ],
      "url": "",
      "caption": "Tu taller, más organizado y eficiente"
    },
    {
      "type": "gallery",
      "enabled": false,
      "title": "Talleres reales, resultados reales",
      "subtitle": "Así transformamos espacios junto a nuestros clientes.",
      "items": []
    },
    {
      "type": "testimonials",
      "enabled": true,
      "title": "Lo que dicen nuestros clientes",
      "items": [
        {
          "name": "Carlos Méndez",
          "role": "Taller automotriz",
          "city": "Cochabamba",
          "quote": "El tablero me ayudó a tener todo más a la mano, no pierdo tiempo buscando herramientas. La calidad es excelente.",
          "stars": 5,
          "photo": ""
        },
        {
          "name": "Daniela Rojas",
          "role": "Hogar",
          "city": "Santa Cruz",
          "quote": "En casa me cambió la vida, ahora tengo todo organizado y se ve increíble. Los accesorios son muy prácticos.",
          "stars": 5,
          "photo": ""
        },
        {
          "name": "Jorge Villarroel",
          "role": "Mecánico",
          "city": "Cochabamba",
          "quote": "Muy buena calidad y resistencia. Lo uso a diario en el taller y sigue como nuevo. Totalmente recomendado.",
          "stars": 5,
          "photo": ""
        }
      ]
    },
    {
      "type": "closing",
      "enabled": true,
      "tagline": "Organiza tu espacio, potencia tu trabajo.",
      "perks": [
        {
          "icon": "◈",
          "text": "Productos de alta calidad"
        },
        {
          "icon": "⛟",
          "text": "Envíos a todo el país"
        },
        {
          "icon": "☎",
          "text": "Atención personalizada"
        }
      ],
      "cta_title": "¿Listo para transformar tu espacio?",
      "cta_label": "Cotizar por WhatsApp"
    }
  ],
  "footer": {
    "text": "PCX · Hecho en Bolivia · Cochabamba · Santa Cruz"
  }
};
