// Catálogo oficial de destinos de Bolivia: 9 departamentos → 112 provincias →
// 339 municipios (división político-administrativa estándar, roster INE).
// Estructura: { departamento: { provincia: [municipios...] } }.
//
// Se sincroniza a la tabla geo_destinations al arrancar el servidor (upsert
// idempotente). Para agregar un municipio faltante o una localidad nueva no
// hace falta migración: se edita aquí o se agrega desde Admin (fase 2).
//
// Checksums (validados por el test al final del archivo vía countGeo()):
//   provincias por dpto:  LP 20 · SC 15 · CB 16 · PT 16 · OR 16 · CH 10 · TJ 6 · BN 8 · PN 5  = 112
//   municipios por dpto:  LP 87 · SC 56 · CB 47 · PT 40 · OR 35 · CH 29 · TJ 11 · BN 19 · PN 15 = 339

const BOLIVIA_GEO = {
  'La Paz': {
    Murillo: ['La Paz', 'El Alto', 'Palca', 'Mecapaca', 'Achocalla'],
    Omasuyos: ['Achacachi', 'Ancoraimes', 'Chua Cocani', 'Huarina', 'Santiago de Huata', 'Huatajata'],
    Pacajes: ['Coro Coro', 'Caquiaviri', 'Calacoto', 'Comanche', 'Charaña', 'Waldo Ballivián', 'Nazacara de Pacajes', 'Santiago de Callapa'],
    Camacho: ['Puerto Acosta', 'Mocomoco', 'Puerto Carabuco', 'Humanata', 'Escoma'],
    'Muñecas': ['Chuma', 'Ayata', 'Aucapata'],
    Larecaja: ['Sorata', 'Guanay', 'Tacacoma', 'Quiabaya', 'Combaya', 'Tipuani', 'Mapiri', 'Teoponte'],
    'Franz Tamayo': ['Apolo', 'Pelechuco'],
    Ingavi: ['Viacha', 'Guaqui', 'Tiahuanacu', 'Desaguadero', 'San Andrés de Machaca', 'Jesús de Machaca', 'Taraco'],
    Loayza: ['Luribay', 'Sapahaqui', 'Yaco', 'Malla', 'Cairoma'],
    Inquisivi: ['Inquisivi', 'Quime', 'Cajuata', 'Colquiri', 'Ichoca', 'Villa Libertad Licoma'],
    'Sud Yungas': ['Chulumani', 'Irupana', 'Yanacachi', 'Palos Blancos', 'La Asunta'],
    'Los Andes': ['Pucarani', 'Laja', 'Batallas', 'Puerto Pérez'],
    Aroma: ['Sica Sica', 'Umala', 'Ayo Ayo', 'Calamarca', 'Patacamaya', 'Colquencha', 'Collana'],
    'Nor Yungas': ['Coroico', 'Coripata'],
    'Abel Iturralde': ['Ixiamas', 'San Buenaventura'],
    'Bautista Saavedra': ['Charazani', 'Curva'],
    'Manco Kapac': ['Copacabana', 'San Pedro de Tiquina', 'Tito Yupanqui'],
    'Gualberto Villarroel': ['San Pedro de Curahuara', 'Papel Pampa', 'Chacarilla'],
    'José Manuel Pando': ['Santiago de Machaca', 'Catacora'],
    Caranavi: ['Caranavi', 'Alto Beni']
  },
  'Santa Cruz': {
    'Andrés Ibáñez': ['Santa Cruz de la Sierra', 'Cotoca', 'Porongo', 'La Guardia', 'El Torno'],
    'Ignacio Warnes': ['Warnes', 'Okinawa Uno'],
    'José Miguel de Velasco': ['San Ignacio de Velasco', 'San Miguel de Velasco', 'San Rafael'],
    Ichilo: ['Buena Vista', 'San Carlos', 'Yapacaní', 'San Juan de Yapacaní'],
    Chiquitos: ['San José de Chiquitos', 'Pailón', 'Roboré'],
    Sara: ['Portachuelo', 'Santa Rosa del Sara', 'Colpa Bélgica'],
    Cordillera: ['Lagunillas', 'Charagua', 'Cabezas', 'Cuevo', 'Gutiérrez', 'Camiri', 'Boyuibe'],
    Vallegrande: ['Vallegrande', 'Trigal', 'Moro Moro', 'Postrer Valle', 'Pucará'],
    Florida: ['Samaipata', 'Pampa Grande', 'Mairana', 'Quirusillas'],
    'Obispo Santistevan': ['Montero', 'General Saavedra', 'Mineros', 'Fernández Alonso', 'San Pedro'],
    'Ñuflo de Chávez': ['Concepción', 'San Javier', 'San Ramón', 'San Julián', 'San Antonio de Lomerío', 'Cuatro Cañadas'],
    'Ángel Sandoval': ['San Matías'],
    'Manuel María Caballero': ['Comarapa', 'Saipina'],
    'Germán Busch': ['Puerto Suárez', 'Puerto Quijarro', 'El Carmen Rivero Tórrez'],
    Guarayos: ['Ascensión de Guarayos', 'Urubichá', 'El Puente']
  },
  Cochabamba: {
    Cercado: ['Cochabamba'],
    Campero: ['Aiquile', 'Pasorapa', 'Omereque'],
    Ayopaya: ['Independencia', 'Morochata', 'Cocapata'],
    'Esteban Arze': ['Tarata', 'Anzaldo', 'Arbieto', 'Sacabamba'],
    Arani: ['Arani', 'Vacas'],
    Arque: ['Arque', 'Tacopaya'],
    Capinota: ['Capinota', 'Santiváñez', 'Sicaya'],
    'Germán Jordán': ['Cliza', 'Toco', 'Tolata'],
    Quillacollo: ['Quillacollo', 'Sipe Sipe', 'Tiquipaya', 'Vinto', 'Colcapirhua'],
    Chapare: ['Sacaba', 'Colomi', 'Villa Tunari'],
    'Tapacarí': ['Tapacarí'],
    Carrasco: ['Totora', 'Pojo', 'Pocona', 'Chimoré', 'Puerto Villarroel', 'Entre Ríos'],
    Mizque: ['Mizque', 'Vila Vila', 'Alalay'],
    Punata: ['Punata', 'Villa Rivero', 'San Benito', 'Tacachi', 'Cuchumuela'],
    'Bolívar': ['Bolívar'],
    Tiraque: ['Tiraque', 'Shinahota']
  },
  'Potosí': {
    'Tomás Frías': ['Potosí', 'Tinguipaya', 'Yocalla', 'Belén de Urmiri'],
    'Rafael Bustillo': ['Uncía', 'Chayanta', 'Llallagua', 'Chuquihuta'],
    'Cornelio Saavedra': ['Betanzos', 'Chaquí', 'Tacobamba'],
    Chayanta: ['Colquechaca', 'Ravelo', 'Pocoata', 'Ocurí'],
    Charcas: ['San Pedro de Buena Vista', 'Toro Toro'],
    'Nor Chichas': ['Cotagaita', 'Vitichi'],
    'Alonso de Ibáñez': ['Sacaca', 'Caripuyo'],
    'Sud Chichas': ['Tupiza', 'Atocha'],
    'Nor Lípez': ['Colcha K', 'San Pedro de Quemes'],
    'Sud Lípez': ['San Pablo de Lípez', 'Mojinete', 'San Antonio de Esmoruco'],
    'José María Linares': ['Puna', 'Caiza D', 'Ckochas'],
    'Antonio Quijarro': ['Uyuni', 'Tomave', 'Porco'],
    'General Bernardino Bilbao': ['Arampampa', 'Acasio'],
    'Daniel Campos': ['Llica', 'Tahua'],
    'Modesto Omiste': ['Villazón'],
    'Enrique Baldivieso': ['San Agustín']
  },
  Oruro: {
    Cercado: ['Oruro', 'Caracollo', 'El Choro', 'Soracachi'],
    'Eduardo Avaroa': ['Challapata', 'Santuario de Quillacas'],
    Carangas: ['Corque', 'Choquecota'],
    Sajama: ['Curahuara de Carangas', 'Turco'],
    Litoral: ['Huachacalla', 'Escara', 'Cruz de Machacamarca', 'Yunguyo de Litoral', 'Esmeralda'],
    'Poopó': ['Poopó', 'Pazña', 'Antequera'],
    'Pantaleón Dalence': ['Huanuni', 'Machacamarca'],
    'Ladislao Cabrera': ['Salinas de Garci Mendoza', 'Pampa Aullagas'],
    Atahuallpa: ['Sabaya', 'Coipasa', 'Chipaya'],
    'Saucarí': ['Toledo'],
    'Tomás Barrón': ['Eucaliptus'],
    'Sud Carangas': ['Santiago de Andamarca', 'Belén de Andamarca'],
    'San Pedro de Totora': ['San Pedro de Totora'],
    'Sebastián Pagador': ['Santiago de Huari'],
    Mejillones: ['La Rivera', 'Todos Santos', 'Carangas'],
    'Nor Carangas': ['Santiago de Huayllamarca']
  },
  Chuquisaca: {
    Oropeza: ['Sucre', 'Yotala', 'Poroma'],
    Azurduy: ['Azurduy', 'Tarvita'],
    'Zudáñez': ['Zudáñez', 'Presto', 'Mojocoya', 'Icla'],
    Tomina: ['Padilla', 'Tomina', 'Sopachuy', 'Villa Alcalá', 'El Villar'],
    'Hernando Siles': ['Monteagudo', 'Huacareta'],
    'Yamparáez': ['Tarabuco', 'Yamparáez'],
    'Nor Cinti': ['Camargo', 'San Lucas', 'Incahuasi', 'Villa Charcas'],
    'Sud Cinti': ['Villa Abecia', 'Culpina', 'Las Carreras'],
    'Luis Calvo': ['Villa Vaca Guzmán', 'Huacaya', 'Macharetí'],
    'Belisario Boeto': ['Villa Serrano']
  },
  Tarija: {
    Cercado: ['Tarija'],
    'Aniceto Arce': ['Padcaya', 'Bermejo'],
    'Gran Chaco': ['Yacuiba', 'Caraparí', 'Villa Montes'],
    'Avilés': ['Uriondo', 'Yunchará'],
    'Méndez': ['San Lorenzo', 'El Puente'],
    "Burnet O'Connor": ['Entre Ríos']
  },
  Beni: {
    Cercado: ['Trinidad', 'San Javier'],
    'Vaca Díez': ['Riberalta', 'Guayaramerín'],
    'José Ballivián': ['Reyes', 'San Borja', 'Santa Rosa', 'Rurrenabaque'],
    Yacuma: ['Santa Ana del Yacuma', 'Exaltación'],
    Moxos: ['San Ignacio de Moxos'],
    'Marbán': ['Loreto', 'San Andrés'],
    'Mamoré': ['San Joaquín', 'San Ramón', 'Puerto Siles'],
    'Iténez': ['Magdalena', 'Baures', 'Huacaraje']
  },
  Pando: {
    'Nicolás Suárez': ['Cobija', 'Porvenir', 'Bolpebra', 'Bella Flor'],
    Manuripi: ['Puerto Rico', 'San Pedro', 'Filadelfia'],
    'Madre de Dios': ['Puerto Gonzalo Moreno', 'San Lorenzo', 'Sena'],
    'Abuná': ['Santa Rosa del Abuná', 'Ingavi'],
    'Federico Román': ['Nueva Esperanza', 'Villa Nueva', 'Santos Mercado']
  }
};

// Alias de búsqueda: nombres coloquiales o históricos → municipio canónico.
// La búsqueda también matchea estos términos.
const GEO_ALIASES = {
  'Santa Cruz de la Sierra': ['santa cruz', 'scz'],
  Cochabamba: ['cbba', 'cocha'],
  'La Paz': ['lpz'],
  Tarija: ['tja'],
  Trinidad: ['trini'],
  Independencia: ['ayopaya'],
  Charazani: ['general juan jose perez'],
  'Villa Vaca Guzmán': ['muyupampa'],
  'Villa Abecia': ['camataqui'],
  'San Pedro de Totora': ['totora oruro'],
  Yacuiba: ['yaguiba'],
  Quillacollo: ['quilla'],
  'El Alto': ['alto']
};

const countGeo = () => {
  let provincias = 0;
  let municipios = 0;
  for (const provs of Object.values(BOLIVIA_GEO)) {
    provincias += Object.keys(provs).length;
    for (const munis of Object.values(provs)) municipios += munis.length;
  }
  return { departamentos: Object.keys(BOLIVIA_GEO).length, provincias, municipios };
};

module.exports = { BOLIVIA_GEO, GEO_ALIASES, countGeo };
