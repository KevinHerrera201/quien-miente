const RAW = {
  panales: {
    label: 'Pañales',
    emoji: '🍼',
    categories: [
      ['animales', 'Animales', '🦁', [
        '¿Cuál es tu animal favorito?',
        '¿Qué animal consideras el más peligroso del mundo?',
        '¿Qué animal tendrías como mascota si no existieran límites?',
        '¿Cuál es el animal terrestre más rápido del planeta?',
      ]],
      ['profesiones', 'Profesiones', '💼', [
        '¿Cuál consideras que es la profesión más difícil de ejercer?',
        '¿Qué trabajo soñabas con tener cuando eras niño?',
        '¿Qué profesión crees que desaparecerá primero en el futuro?',
        '¿Cuál es la profesión mejor pagada de la actualidad?',
      ]],
      ['deportes', 'Deportes', '⚽', [
        '¿Qué deporte es el más grande del mundo en popularidad?',
        '¿Cuál es el deporte que más te gusta practicar o mirar?',
        '¿Qué deporte consideras el más extremo o arriesgado?',
        '¿Cuál es el evento deportivo más importante del planeta?',
      ]],
      ['instrumentos', 'Instrumentos musicales', '🎸', [
        '¿Cuál es el instrumento musical más fácil de aprender a tocar?',
        '¿Qué instrumento tiene el sonido más relajante?',
        '¿Cuál es el instrumento más representativo de una orquesta?',
        '¿Qué instrumento musical te gustaría dominar?',
      ]],
      ['transporte', 'Medios de transporte', '✈️', [
        '¿Cuál es el medio de transporte más seguro para viajar?',
        '¿Qué transporte utilizas con mayor frecuencia en tu día a día?',
        '¿Cuál es el medio de transporte más rápido disponible para el público?',
        '¿Qué transporte elegirías para viajar por todo el mundo?',
      ]],
      ['comidas', 'Comidas', '🍔', [
        '¿Cuál es tu comida rápida favorita?',
        '¿Qué platillo representa mejor la gastronomía de tu país?',
        '¿Cuál es la comida que nunca te cansarías de comer?',
        '¿Qué comida típica le recomendarías a un extranjero?',
      ]],
      ['prendas', 'Prendas de vestir', '👕', [
        '¿Qué prenda de vestir usarías para ir a un cumpleaños elegante?',
        '¿Cuál es la prenda de vestir más cómoda que tienes?',
        '¿Qué accesorio o prenda nunca puede faltar en tu guardarropa?',
        '¿Qué prenda consideras indispensable para un día de frío intenso?',
      ]],
      ['herramientas', 'Herramientas', '🔨', [
        '¿Cuál es la herramienta básica que toda casa debería tener?',
        '¿Qué herramienta consideras la más peligrosa al usar?',
        '¿Cuál es la herramienta eléctrica más útil en un taller?',
        '¿Qué herramienta manual es la más versátil para hacer reparaciones?',
      ]],
      ['cuerpo', 'Partes del cuerpo humano', '🦴', [
        '¿Cuál es el órgano más importante para el funcionamiento del cuerpo?',
        '¿Qué parte del cuerpo humano consideras la más frágil o delicada?',
        '¿Cuál es el hueso más largo del cuerpo humano?',
        '¿Qué sentido del cuerpo humano crees que usamos más a diario?',
      ]],
      ['muebles', 'Muebles del hogar', '🛋️', [
        '¿Cuál es el mueble más cómodo de toda tu casa?',
        '¿Qué mueble es el primero que comprarías al mudarte solo?',
        '¿Cuál consideras que es el mueble principal de una sala de estar?',
        '¿Qué mueble resulta indispensable en una habitación de trabajo o estudio?',
      ]],
    ],
  },
  cabrones: {
    label: 'Cabrones',
    emoji: '😈',
    categories: [
      ['clima', 'Climas y fenómenos naturales', '⛈️', [
        '¿Qué desastre natural usarías como excusa perfecta para no ir a trabajar el lunes?',
        '¿Clima ideal para quedarte llorando en tu cuarto fingiendo que eres el protagonista de un video musical?',
        '¿Qué fenómeno natural crees que es solo un invento del gobierno para que no salgamos de casa?',
        '¿En qué tipo de clima serías más propenso a volverte un villano de cómic?',
      ]],
      ['cine', 'Géneros cinematográficos', '🎬', [
        '¿Qué género de película elegirías si quisieras aburrir a tu cita para que se vaya temprano de tu casa?',
        '¿Género cinematográfico que te hace sentir más inteligente de lo que realmente eres cuando lo recomiendas?',
        '¿Qué tipo de película te da pánico ver solo en la madrugada después de escuchar un ruido en la cocina?',
        '¿En qué género encajaría perfectamente el peor oso que has pasado en público?',
      ]],
      ['electro', 'Electrodomésticos', '📺', [
        '¿Qué electrodoméstico de tu cocina crees que te juzga en silencio por tu forma de comer?',
        '¿Con qué aparato tendrías una pelea a golpes a muerte y probablemente perderías?',
        '¿Qué electrodoméstico intentarías usar como arma durante un apocalipsis zombi?',
        '¿Cuál es el aparato que compraste jurando que serías más "fitness" y ahora solo lo usas para colgar ropa?',
      ]],
      ['monumentos', 'Monumentos históricos', '🗿', [
        '¿Qué monumento famoso crees que fue construido por extraterrestres que estaban muy aburridos?',
        '¿En qué ruina histórica te esconderías si tuvieras que huir del país con una identidad falsa?',
        '¿Qué estatua importante te da la sensación de que te mira feo cuando te das la vuelta?',
        '¿Qué maravilla del mundo venderías en internet si pudieras salirte con la tuya?',
      ]],
      ['musica', 'Géneros musicales', '🎵', [
        '¿Qué género musical pones a todo volumen a las 7 AM cuando quieres vengarte de tus vecinos?',
        '¿Qué música escucharías mientras finges trabajar concentrado frente a tu jefe?',
        '¿Qué ritmo musical te da ganas de golpear la pared sin ninguna razón lógica?',
        '¿Qué canción usarías de fondo si tuvieras que pelear a puñetazos con un canguro?',
      ]],
      ['mesa', 'Juegos de mesa', '🎲', [
        '¿Qué juego de mesa ha arruinado más amistades irreparables en tu grupo de amigos?',
        '¿Juego de mesa que te da miedo porque saca a relucir tu lado más psicópata y manipulador?',
        '¿En qué juego le harías trampa descaradamente a un niño de 8 años solo para no perder tu dignidad?',
        '¿Qué juego parece inofensivo pero requiere que tengas un doctorado para entender las reglas?',
      ]],
      ['idiomas', 'Idiomas del mundo', '🗣️', [
        '¿Qué idioma suena como si alguien te estuviera insultando gravísimo aunque te esté diciendo "buenos días"?',
        '¿Idioma que hablan en Brasil cuando están de mal humor y se les acaba la caipirinha?',
        '¿Qué acento usarías para fingir ser otra persona y librarte de que te cobren una deuda?',
        '¿Qué idioma inventarías que hablas en tu currículum solo para ver si la de Recursos Humanos te descubre?',
      ]],
      ['postres', 'Postres y dulces', '🍰', [
        '¿Qué postre es tan empalagoso que te hace sentir que tus dientes te piden perdón por nacer?',
        '¿Por qué dulce estarías dispuesto a pelearte a muerte en la fila de la caja del supermercado?',
        '¿Qué pastel le regalarías a alguien que te cae pésimo pero tienes que quedar bien en su cumpleaños?',
        '¿Qué postre finísimo pides en un restaurante caro solo para fingir que tienes cultura gastronómica?',
      ]],
      ['bebidas', 'Bebidas', '🍹', [
        '¿Bebida con la que te encanta ponerte ebrio y hacer el ridículo cantando a gritos?',
        '¿Qué líquido tomas en la mañana que sabe a gasolina de avión pero te mantiene vivo en el trabajo?',
        '¿Qué bebida le darías a tu peor enemigo diciendo que es un "cóctel exótico"?',
        '¿Qué trago tiene la culpa de que le mandaras un mensaje a tu ex a las 3 de la mañana?',
      ]],
      ['turismo', 'Lugares turísticos', '🏝️', [
        '¿Lugar turístico donde besarías a una mujer fea solo para que la foto de Instagram tenga un fondo épico?',
        '¿Qué destino "paradisíaco" famoso huele a basura y nadie lo admite?',
        '¿En qué lugar turístico fingirías que te robaron para que tu familia te pague el vuelo de regreso?',
        '¿Qué país elegirías para perderte "accidentalmente" y no volver a ver a nadie de tu oficina nunca más?',
      ]],
    ],
  },
  universitario: {
    label: 'Universitario',
    emoji: '🎓',
    categories: [
      ['poderes', 'Superpoderes', '⚡', [
        '¿Fuerza de qué insecto pedirías para ganar siempre jugando fuercitas?',
        '¿Qué poder cuántico usarías exclusivamente para no hacer fila en el banco?',
        '¿Cuál elemento radiactivo de la tabla periódica lanzarías como rayo láser por los ojos?',
        '¿A qué velocidad supersónica (en Mach) te irías corriendo de un asalto?',
      ]],
      ['excusas', 'Excusas para cancelar planes', '🤒', [
        '¿Qué enfermedad medieval erradicada fingirías tener para no ir a una boda?',
        '¿Qué evento astronómico usarías de pretexto para no salir el viernes por la noche?',
        '¿Qué hueso del cuerpo humano dirías que te duele para quedarte en cama todo el día?',
        '¿A qué desastre natural le echarías la culpa por no haber entregado un reporte?',
      ]],
      ['fobias', 'Fobias o miedos absurdos', '😱', [
        '¿Cómo se llama clínicamente el miedo irracional a las alturas?',
        '¿El miedo irracional a qué animal de granja arruinaría tu viaje al campo?',
        '¿Qué fobia a un patrón geométrico te impediría comerte un panal de miel?',
        '¿Qué tipo de espacio cerrado te daría pánico si sufres claustrofobia extrema?',
      ]],
      ['tatuajes', 'Tatuajes vergonzosos', '🖋️', [
        '¿Fórmula matemática de qué famoso físico te tatuarías para fingir ser un genio?',
        '¿Qué estructura biológica (en forma de hélice) te tatuarías para verte intelectual?',
        '¿En qué idioma antiguo y muerto te harías un tatuaje vergonzoso para que nadie lo lea?',
        '¿El rostro de qué emperador romano loco te tatuarías por perder una apuesta?',
      ]],
      ['apps', 'Aplicaciones del celular', '📱', [
        '¿Qué aplicación borrarías primero si el FBI te estuviera buscando?',
        '¿Qué red social de videos crees que resta más puntos de coeficiente intelectual (IQ)?',
        '¿Qué app de navegación GPS usaría Cristóbal Colón si estuviera vivo hoy?',
        '¿Qué aplicación de citas usaría un biólogo si quisiera estudiar el cortejo humano?',
      ]],
      ['vecinos', 'Tipos de vecinos', '🏘️', [
        '¿Qué hortaliza ahuyenta al vecino "vampiro" que siempre viene a pedir azúcar?',
        '¿Qué subgénero del metal pondrías a las 3 AM para vengarte del vecino ruidoso?',
        '¿Qué gas químico, que huele a huevo podrido, soltarías en el patio de al lado?',
        '¿Qué raza de perro guardián enorme comprarías solo para intimidar al vecino chismoso?',
      ]],
      ['conspiraciones', 'Teorías conspirativas', '👽', [
        '¿Qué forma geométrica tiene la Tierra según la teoría conspirativa más famosa de internet?',
        '¿Qué tipo de reptil humanoide dicen las conspiraciones que controla los gobiernos del mundo?',
        '¿Qué sociedad secreta dicen que está detrás del símbolo del ojo en el billete de un dólar?',
        '¿Qué continente de hielo afirman los conspiranoicos que esconde el borde del planeta?',
      ]],
      ['regalos', 'Regalos de intercambio', '🎁', [
        '¿Qué insecto chupador de sangre (usado en medicina medieval) regalarías en un frasco?',
        '¿Qué famosa planta carnívora regalarías sabiendo que huele pésimo cuando digiere?',
        '¿El libro de qué filósofo alemán súper pesimista regalarías para arruinarle la Navidad a alguien?',
        '¿Qué gas noble usarías para inflar un globo de regalo que no flote y sea aburrido?',
      ]],
      ['insultos', 'Insultos creativos o antiguos', '📜', [
        '¿Qué insulto del siglo XVI (con \'M\') significa "tonto" o "de escaso juicio"?',
        '¿Qué nombre de homínido extinto usarías para llamar a alguien primitivo y salvaje?',
        '¿Con qué organismo unicelular microscópico compararías el cerebro de tu ex?',
        '¿El nombre de qué ave no voladora extinta en Mauricio usarías para decirle a alguien torpe?',
      ]],
      ['incomodas', 'Situaciones incómodas en público', '😳', [
        '¿Qué figura geométrica harías caminando hacia atrás si se te rompe el pantalón?',
        '¿En qué país asiático fingirías haber nacido para escapar de una plática incómoda?',
        '¿Qué saludo militar (de qué imperio extinto) harías para disimular que te caíste de cara?',
        '¿Qué pronombre o apodo genérico (ej. "bro") usas cuando olvidas cómo se llama tu amigo?',
      ]],
    ],
  },
};

const PALETTE = [
  ['#ff6b6b', '#c0392b'], ['#feca57', '#e67e22'], ['#48dbfb', '#2e86de'], ['#1dd1a1', '#10ac84'],
  ['#ff9ff3', '#c44569'], ['#a29bfe', '#6c5ce7'], ['#fd9644', '#d35400'], ['#55efc4', '#00a885'],
  ['#74b9ff', '#0652dd'], ['#fab1a0', '#e17055'],
];

const CATEGORIES = {};
const LEVELS = {};

for (const [levelKey, level] of Object.entries(RAW)) {
  const questions = [];
  level.categories.forEach(([catId, name, emoji, list], i) => {
    CATEGORIES[catId] = { name, emoji, colors: PALETTE[i % PALETTE.length] };
    list.forEach((text, j) => questions.push({ id: `${catId}-${j}`, catId, text }));
  });
  LEVELS[levelKey] = { label: level.label, emoji: level.emoji, questions };
}

module.exports = { CATEGORIES, LEVELS };
