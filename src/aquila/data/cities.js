// Settlements that seed the provinces. [name, lon, lat, owner, population (thousands), culture, region]
// Provinces grow outward from each city over land, so every city becomes one province.

export const CITIES = [
  // Italia
  ['Roma', 12.49, 41.9, 'rome', 40, 'roman', 'Latium'],
  ['Capua', 14.25, 41.08, 'rome', 18, 'roman', 'Campania'],
  ['Arretium', 11.88, 43.46, 'rome', 10, 'roman', 'Etruria'],
  ['Ariminum', 12.57, 44.06, 'free', 7, 'roman', 'Umbria'],
  ['Tarentum', 17.24, 40.47, 'greeks', 16, 'hellenic', 'Magna Graecia'],
  ['Rhegium', 15.65, 38.6, 'free', 7, 'hellenic', 'Bruttium'],
  ['Genua', 8.93, 44.41, 'free', 6, 'gallic', 'Liguria'],
  ['Patavium', 11.88, 45.41, 'free', 9, 'local', 'Venetia'],
  ['Mediolanum', 9.19, 45.46, 'gaul', 12, 'gallic', 'Gallia Cisalpina'],
  ['Syracusae', 15.29, 37.07, 'greeks', 20, 'hellenic', 'Sicilia'],
  ['Lilybaeum', 12.44, 37.8, 'carthage', 9, 'punic', 'Sicilia Punica'],
  ['Carales', 9.11, 39.22, 'carthage', 8, 'punic', 'Sardinia'],
  ['Aleria', 9.51, 42.1, 'free', 4, 'local', 'Corsica'],

  // Africa
  ['Carthago', 10.32, 36.85, 'carthage', 45, 'punic', 'Africa'],
  ['Hadrumetum', 10.6, 35.4, 'carthage', 12, 'punic', 'Byzacena'],
  ['Leptis Magna', 14.29, 32.64, 'carthage', 10, 'punic', 'Tripolitania'],
  ['Cirta', 6.61, 36.36, 'numidia', 14, 'african', 'Numidia'],
  ['Iol', 2.19, 36.6, 'numidia', 7, 'african', 'Mauretania Caesariensis'],
  ['Siga', -1.2, 35.2, 'numidia', 6, 'african', 'Masaesylia'],
  ['Tingis', -5.8, 35.77, 'free', 7, 'african', 'Mauretania'],
  ['Volubilis', -5.55, 34.07, 'free', 6, 'african', 'Atlas'],
  ['Garama', 13.25, 26.5, 'free', 5, 'african', 'Garamantia'],
  ['Cyrene', 21.85, 32.82, 'egypt', 12, 'hellenic', 'Cyrenaica'],
  ['Paraetonium', 27.25, 31.35, 'egypt', 4, 'ptolemaic', 'Marmarica'],
  ['Alexandria', 29.92, 31.2, 'egypt', 50, 'ptolemaic', 'Aegyptus'],
  ['Memphis', 31.25, 29.85, 'egypt', 25, 'ptolemaic', 'Middle Egypt'],
  ['Thebae', 32.65, 25.7, 'egypt', 14, 'ptolemaic', 'Thebais'],
  ['Napata', 31.82, 18.53, 'free', 8, 'african', 'Kush'],

  // Hispania
  ['Carthago Nova', -0.98, 37.6, 'carthage', 12, 'punic', 'Contestania'],
  ['Gades', -6.29, 36.53, 'carthage', 11, 'punic', 'Baetica'],
  ['Corduba', -4.78, 37.88, 'iberia', 9, 'iberian', 'Turdetania'],
  ['Toletum', -4.02, 39.86, 'iberia', 7, 'iberian', 'Carpetania'],
  ['Numantia', -2.44, 41.8, 'iberia', 10, 'iberian', 'Celtiberia'],
  ['Tarraco', 1.25, 41.12, 'iberia', 8, 'iberian', 'Ilergetia'],
  ['Saguntum', -0.27, 39.68, 'free', 8, 'iberian', 'Edetania'],
  ['Olisipo', -9.14, 38.72, 'free', 7, 'iberian', 'Lusitania'],
  ['Emerita', -6.34, 38.92, 'iberia', 6, 'iberian', 'Vettonia'],
  ['Bracara', -8.43, 41.55, 'free', 6, 'iberian', 'Gallaecia'],
  ['Asturica', -6.05, 42.46, 'free', 5, 'iberian', 'Asturia'],
  ['Pompaelo', -1.64, 42.81, 'iberia', 5, 'iberian', 'Vasconia'],

  // Gallia
  ['Massilia', 5.37, 43.3, 'greeks', 14, 'hellenic', 'Massalia'],
  ['Narbo', 3.0, 43.18, 'gaul', 7, 'gallic', 'Narbonensis'],
  ['Tolosa', 1.44, 43.6, 'gaul', 8, 'gallic', 'Volcae'],
  ['Burdigala', -0.58, 44.84, 'gaul', 7, 'gallic', 'Aquitania'],
  ['Gergovia', 3.12, 45.71, 'gaul', 14, 'gallic', 'Arvernia'],
  ['Lugdunum', 4.83, 45.76, 'gaul', 9, 'gallic', 'Segusiavi'],
  ['Avaricum', 2.4, 47.08, 'gaul', 9, 'gallic', 'Bituriges'],
  ['Lutetia', 2.35, 48.85, 'gaul', 7, 'gallic', 'Parisii'],
  ['Alesia', 4.5, 47.54, 'gaul', 8, 'gallic', 'Mandubii'],
  ['Durocortorum', 4.03, 49.26, 'gaul', 8, 'gallic', 'Belgica'],
  ['Condate', -1.68, 48.11, 'gaul', 6, 'gallic', 'Armorica'],
  ['Aventicum', 7.03, 46.88, 'free', 6, 'gallic', 'Helvetia'],
  ['Samarobriva', 2.3, 50.0, 'free', 6, 'gallic', 'Ambiani'],

  // Britannia & Hibernia
  ['Londinium', -0.12, 51.5, 'britons', 7, 'briton', 'Cantium'],
  ['Venta', 1.3, 52.63, 'free', 5, 'briton', 'Iceni'],
  ['Isca', -3.53, 50.72, 'britons', 5, 'briton', 'Dumnonia'],
  ['Deva', -2.89, 53.19, 'britons', 5, 'briton', 'Ordovices'],
  ['Eboracum', -1.08, 53.96, 'britons', 8, 'briton', 'Brigantia'],
  ['Caledonia', -4.0, 56.6, 'free', 5, 'briton', 'Caledonia'],
  ['Tara', -6.6, 53.58, 'free', 5, 'briton', 'Hibernia'],

  // Germania & the North
  ['Colonia', 6.95, 50.94, 'germans', 6, 'german', 'Ubii'],
  ['Mattium', 9.3, 51.15, 'germans', 6, 'german', 'Chatti'],
  ['Teutoburgium', 8.4, 52.4, 'germans', 5, 'german', 'Cherusci'],
  ['Frisia', 6.0, 53.2, 'free', 4, 'german', 'Frisii'],
  ['Cimbria', 9.5, 56.1, 'free', 5, 'german', 'Cimbri'],
  ['Scandza', 14.5, 57.6, 'free', 5, 'german', 'Scandia'],
  ['Semnonia', 13.3, 52.5, 'germans', 9, 'german', 'Suebia'],
  ['Lugia', 17.0, 51.1, 'germans', 6, 'german', 'Lugii'],
  ['Gothiscandza', 18.6, 54.0, 'free', 5, 'german', 'Gutones'],
  ['Boiohaemum', 14.4, 50.0, 'free', 7, 'gallic', 'Boii'],
  ['Vindelicia', 10.9, 48.37, 'free', 5, 'gallic', 'Vindelici'],
  ['Noreia', 14.3, 47.0, 'free', 8, 'gallic', 'Noricum'],
  ['Aestia', 22.5, 55.0, 'free', 4, 'local', 'Aestii'],

  // Balkans & Greece
  ['Segestica', 16.37, 45.47, 'free', 6, 'local', 'Pannonia'],
  ['Aquincum', 19.04, 47.5, 'free', 6, 'gallic', 'Eravisci'],
  ['Salona', 16.48, 43.54, 'free', 7, 'local', 'Illyria'],
  ['Scodra', 19.51, 42.07, 'free', 7, 'local', 'Ardiaei'],
  ['Singidunum', 20.46, 44.82, 'free', 6, 'gallic', 'Scordisci'],
  ['Naissus', 21.9, 43.32, 'free', 5, 'local', 'Dardania'],
  ['Ambracia', 20.98, 39.16, 'greeks', 10, 'hellenic', 'Epirus'],
  ['Pella', 22.52, 40.76, 'macedon', 28, 'hellenic', 'Macedonia'],
  ['Amphipolis', 23.85, 40.82, 'macedon', 12, 'hellenic', 'Chalcidice'],
  ['Larissa', 22.42, 39.64, 'macedon', 12, 'hellenic', 'Thessalia'],
  ['Corinthus', 22.9, 37.9, 'macedon', 18, 'hellenic', 'Achaea'],
  ['Athenae', 23.73, 38.05, 'greeks', 30, 'hellenic', 'Attica'],
  ['Sparta', 22.43, 37.07, 'greeks', 10, 'hellenic', 'Laconia'],
  ['Gortyn', 24.95, 35.06, 'free', 9, 'hellenic', 'Creta'],
  ['Rhodus', 28.22, 36.33, 'greeks', 14, 'hellenic', 'Rhodus'],
  ['Byzantium', 28.98, 41.01, 'greeks', 16, 'hellenic', 'Propontis'],
  ['Seuthopolis', 25.38, 42.62, 'dacia', 8, 'dacian', 'Thracia'],
  ['Sarmizegetusa', 23.31, 45.62, 'dacia', 12, 'dacian', 'Dacia'],
  ['Porolissum', 23.17, 47.4, 'dacia', 6, 'dacian', 'Porolissensis'],
  ['Tomis', 28.65, 44.17, 'dacia', 7, 'dacian', 'Moesia'],
  ['Getia', 27.2, 46.8, 'dacia', 6, 'dacian', 'Getae'],
  ['Serdica', 23.32, 42.7, 'free', 6, 'dacian', 'Serdi'],

  // Asia Minor & Caucasus
  ['Pergamon', 27.18, 39.13, 'free', 14, 'hellenic', 'Mysia'],
  ['Sardis', 28.04, 38.2, 'seleucid', 14, 'hellenic', 'Lydia'],
  ['Halicarnassus', 27.43, 37.04, 'egypt', 9, 'hellenic', 'Caria'],
  ['Nicomedia', 29.92, 40.77, 'free', 10, 'hellenic', 'Bithynia'],
  ['Side', 31.39, 36.77, 'egypt', 7, 'hellenic', 'Pamphylia'],
  ['Ancyra', 32.86, 39.93, 'free', 7, 'gallic', 'Galatia'],
  ['Sinope', 35.15, 42.03, 'free', 10, 'hellenic', 'Pontus'],
  ['Trapezus', 39.72, 41.0, 'free', 7, 'hellenic', 'Pontus Polemoniacus'],
  ['Mazaca', 35.48, 38.72, 'free', 9, 'local', 'Cappadocia'],
  ['Tarsus', 34.9, 36.92, 'seleucid', 12, 'seleucid', 'Cilicia'],
  ['Iconium', 32.48, 37.87, 'seleucid', 7, 'seleucid', 'Lycaonia'],
  ['Salamis', 33.9, 35.18, 'egypt', 10, 'hellenic', 'Cyprus'],
  ['Phasis', 41.67, 42.15, 'free', 5, 'local', 'Colchis'],
  ['Mtskheta', 44.72, 41.84, 'free', 6, 'local', 'Iberia Caucasica'],
  ['Artaxata', 44.55, 39.95, 'free', 9, 'eastern', 'Armenia'],
  ['Kabalaka', 47.2, 40.9, 'free', 5, 'eastern', 'Albania'],

  // Levant & Mesopotamia
  ['Antiochia', 36.16, 36.2, 'seleucid', 40, 'seleucid', 'Syria'],
  ['Damascus', 36.3, 33.51, 'egypt', 14, 'seleucid', 'Coele-Syria'],
  ['Tyrus', 35.2, 33.27, 'egypt', 12, 'punic', 'Phoenicia'],
  ['Hierosolyma', 35.23, 31.78, 'egypt', 12, 'seleucid', 'Judaea'],
  ['Petra', 35.44, 30.33, 'free', 8, 'local', 'Nabataea'],
  ['Palmyra', 38.27, 34.55, 'free', 8, 'local', 'Palmyrene'],
  ['Edessa', 38.79, 37.16, 'seleucid', 10, 'seleucid', 'Osroene'],
  ['Nisibis', 41.22, 37.07, 'seleucid', 8, 'seleucid', 'Mygdonia'],
  ['Arbela', 44.01, 36.19, 'seleucid', 9, 'seleucid', 'Adiabene'],
  ['Seleucia', 44.52, 33.1, 'seleucid', 35, 'seleucid', 'Babylonia'],
  ['Charax', 47.6, 30.6, 'seleucid', 9, 'seleucid', 'Characene'],
  ['Susa', 48.26, 32.19, 'seleucid', 14, 'eastern', 'Susiana'],
  ['Ecbatana', 48.51, 34.8, 'seleucid', 16, 'eastern', 'Media'],
  ['Persepolis', 52.89, 29.93, 'seleucid', 12, 'eastern', 'Persis'],
  ['Carmana', 57.07, 30.28, 'free', 6, 'eastern', 'Carmania'],
  ['Gerrha', 49.9, 25.9, 'free', 6, 'local', 'Arabia Eastern'],
  ['Hegra', 37.95, 26.8, 'free', 5, 'local', 'Arabia Petraea'],
  ['Mariba', 45.35, 15.42, 'free', 9, 'local', 'Saba'],
  ['Omana', 57.5, 22.9, 'free', 5, 'local', 'Magan'],

  // Persia & the Far East
  ['Rhagae', 51.45, 35.6, 'seleucid', 10, 'eastern', 'Media Rhagiana'],
  ['Hecatompylos', 54.4, 36.4, 'parthia', 12, 'eastern', 'Parthyene'],
  ['Nisa', 58.2, 37.95, 'parthia', 8, 'eastern', 'Parthia'],
  ['Hyrcania', 54.5, 37.0, 'parthia', 7, 'eastern', 'Hyrcania'],
  ['Merv', 61.83, 37.66, 'parthia', 10, 'eastern', 'Margiana'],
  ['Artacoana', 62.2, 34.35, 'seleucid', 8, 'eastern', 'Aria'],
  ['Prophthasia', 61.5, 31.0, 'free', 6, 'eastern', 'Drangiana'],
  ['Bactra', 66.9, 36.75, 'free', 16, 'hellenic', 'Bactria'],
  ['Maracanda', 66.97, 39.65, 'free', 10, 'steppe', 'Sogdiana'],
  ['Alexandria Arachosia', 65.7, 31.6, 'free', 8, 'eastern', 'Arachosia'],
  ['Kapisa', 69.2, 34.7, 'free', 7, 'eastern', 'Paropamisadae'],
  ['Taxila', 72.8, 33.75, 'free', 18, 'eastern', 'Gandhara'],
  ['Patala', 68.4, 25.4, 'free', 8, 'eastern', 'Sindh'],
  ['Chorasmia', 60.6, 41.5, 'free', 6, 'steppe', 'Chorasmia'],
  ['Dahae', 56.0, 40.0, 'free', 5, 'steppe', 'Dahae'],
  ['Massagetia', 64.0, 44.2, 'free', 5, 'steppe', 'Massagetae'],

  // Steppe
  ['Olbia', 31.9, 46.69, 'scythia', 9, 'hellenic', 'Hylaea'],
  ['Chersonesus', 33.49, 44.61, 'greeks', 8, 'hellenic', 'Taurica'],
  ['Panticapaeum', 36.47, 45.35, 'free', 10, 'hellenic', 'Bosporus'],
  ['Gerrhus', 34.6, 47.6, 'scythia', 9, 'steppe', 'Scythia'],
  ['Tanais', 39.25, 47.27, 'scythia', 7, 'steppe', 'Maeotis'],
  ['Rha', 45.0, 48.8, 'scythia', 5, 'steppe', 'Sarmatia'],
  ['Neuria', 27.0, 51.6, 'free', 4, 'local', 'Neuri'],
  ['Budinia', 37.0, 52.2, 'free', 4, 'local', 'Budini'],
  ['Thyssagetia', 47.0, 55.0, 'free', 4, 'steppe', 'Thyssagetae'],
  ['Aorsia', 52.0, 47.5, 'free', 4, 'steppe', 'Aorsi'],
];

// Mountain ranges: lon/lat polylines with height (world units) and half-width (degrees)
export const RIDGES = [
  { h: 0.62, w: 0.55, p: [[5.9, 44.1], [6.9, 45.3], [7.2, 45.9], [8.5, 46.4], [10.3, 46.5], [12.3, 46.8], [14.0, 47.1], [15.8, 47.6]] }, // Alps
  { h: 0.42, w: 0.38, p: [[-1.8, 43.05], [0.0, 42.75], [1.6, 42.6], [2.9, 42.45]] }, // Pyrenees
  { h: 0.3, w: 0.42, p: [[8.6, 44.4], [10.3, 44.2], [12.0, 43.6], [13.3, 42.5], [14.6, 41.4], [15.6, 40.6], [16.1, 39.6], [16.2, 38.6]] }, // Apennines
  { h: 0.28, w: 0.4, p: [[-8.0, 42.9], [-6.0, 43.0], [-4.0, 43.1], [-2.5, 42.9]] }, // Cantabrian
  { h: 0.16, w: 1.6, p: [[-6.0, 40.3], [-3.6, 40.4], [-2.0, 40.8]] }, // Meseta
  { h: 0.3, w: 0.4, p: [[-4.6, 37.05], [-2.7, 37.15]] }, // Sierra Nevada
  { h: 0.48, w: 0.75, p: [[-9.3, 30.6], [-7.5, 31.1], [-5.5, 31.9], [-3.6, 32.6], [-1.0, 33.6], [2.0, 34.6], [5.0, 35.3], [7.5, 35.4], [9.4, 35.3]] }, // Atlas
  { h: 0.22, w: 0.3, p: [[-5.5, 35.1], [-4.0, 35.0], [-3.0, 35.1]] }, // Rif
  { h: 0.22, w: 0.75, p: [[2.6, 44.6], [2.9, 45.4], [3.3, 46.0]] }, // Massif Central
  { h: 0.16, w: 0.35, p: [[5.8, 46.2], [6.9, 47.2], [7.7, 48.4]] }, // Jura/Vosges
  { h: 0.3, w: 0.5, p: [[17.6, 49.2], [19.8, 49.4], [22.4, 48.9], [24.5, 47.8], [25.6, 46.6], [25.5, 45.6], [24.0, 45.4], [22.3, 45.3]] }, // Carpathians
  { h: 0.32, w: 0.55, p: [[14.6, 45.4], [16.0, 44.5], [17.6, 43.6], [19.0, 42.8], [20.4, 41.9], [21.0, 40.8], [21.3, 39.6], [21.9, 38.7]] }, // Dinaric + Pindus
  { h: 0.24, w: 0.35, p: [[22.6, 43.2], [24.6, 42.8], [26.8, 42.7]] }, // Haemus
  { h: 0.22, w: 0.4, p: [[23.4, 41.7], [24.8, 41.5]] }, // Rhodope
  { h: 0.38, w: 0.7, p: [[28.8, 37.0], [30.8, 36.9], [32.8, 36.6], [34.6, 37.3], [36.6, 37.9], [38.6, 38.3], [40.6, 38.6]] }, // Taurus
  { h: 0.32, w: 0.45, p: [[31.0, 41.0], [33.6, 41.3], [36.5, 40.9], [39.0, 40.6], [41.6, 41.0]] }, // Pontic
  { h: 0.22, w: 2.6, p: [[31.0, 39.0], [34.5, 39.2]] }, // Anatolian plateau
  { h: 0.62, w: 0.45, p: [[37.6, 44.4], [40.0, 43.5], [42.6, 42.9], [44.6, 42.5], [46.6, 41.6], [49.0, 40.6]] }, // Caucasus
  { h: 0.42, w: 1.4, p: [[40.6, 39.6], [43.0, 39.4], [45.6, 38.8]] }, // Armenian highlands
  { h: 0.45, w: 1.0, p: [[44.6, 37.3], [46.0, 35.6], [47.6, 33.8], [49.6, 32.0], [51.8, 30.2], [54.2, 28.6], [56.4, 27.4]] }, // Zagros
  { h: 0.52, w: 0.45, p: [[48.6, 37.6], [50.4, 36.4], [52.0, 35.9], [54.0, 36.5], [56.0, 37.2], [58.6, 37.6]] }, // Elburz + Kopet Dag
  { h: 0.22, w: 4.2, p: [[54.0, 32.5], [59.0, 31.5]] }, // Iranian plateau
  { h: 0.7, w: 1.0, p: [[64.4, 34.4], [67.5, 35.1], [70.0, 35.6], [72.5, 36.4], [74.5, 36.6]] }, // Hindu Kush
  { h: 0.75, w: 1.2, p: [[71.0, 38.8], [73.5, 38.6], [75.0, 39.2]] }, // Pamir
  { h: 0.34, w: 0.6, p: [[69.0, 29.5], [69.6, 31.5], [70.0, 33.4]] }, // Sulaiman
  { h: 0.28, w: 0.8, p: [[62.0, 33.0], [64.0, 33.5]] }, // Afghan hills
  { h: 0.24, w: 0.28, p: [[35.6, 33.3], [36.3, 34.4]] }, // Lebanon
  { h: 0.26, w: 0.7, p: [[35.2, 29.5], [36.6, 27.4], [38.4, 24.6], [39.8, 21.8], [41.4, 19.0], [43.0, 16.6]] }, // Hejaz
  { h: 0.4, w: 0.9, p: [[43.6, 15.5], [44.4, 14.2]] }, // Yemen
  { h: 0.24, w: 0.4, p: [[33.6, 28.6], [34.1, 28.4]] }, // Sinai
  { h: 0.32, w: 1.4, p: [[5.5, 23.3], [6.2, 24.4]] }, // Hoggar
  { h: 0.36, w: 1.3, p: [[17.8, 20.8], [19.0, 21.4]] }, // Tibesti
  { h: 0.24, w: 0.4, p: [[56.0, 24.0], [57.5, 23.2], [58.8, 22.6]] }, // Hajar
  { h: 0.22, w: 0.75, p: [[-5.8, 56.3], [-4.8, 57.1], [-3.4, 57.3]] }, // Highlands
  { h: 0.12, w: 0.4, p: [[-3.9, 52.0], [-3.6, 52.9]] }, // Cambria
  { h: 0.34, w: 1.0, p: [[6.0, 59.0], [7.6, 60.4], [9.2, 61.8]] }, // Scandinavian mts
  { h: 0.2, w: 0.5, p: [[59.0, 51.0], [59.3, 55.0], [59.4, 59.0], [59.6, 62.0]] }, // Ural
  { h: 0.12, w: 1.2, p: [[9.2, 50.6], [11.5, 50.8]] }, // German uplands
  { h: 0.16, w: 0.5, p: [[12.4, 50.4], [14.6, 50.8], [16.4, 50.4], [15.0, 49.0], [13.2, 49.2]] }, // Bohemian rim
  { h: 0.26, w: 0.35, p: [[8.9, 42.0], [9.3, 42.7]] }, // Corsica
  { h: 0.16, w: 0.35, p: [[9.2, 39.6], [9.4, 40.6]] }, // Sardinia
  { h: 0.28, w: 0.25, p: [[14.95, 37.75], [15.0, 37.76]] }, // Etna
  { h: 0.22, w: 0.25, p: [[23.6, 35.3], [24.8, 35.25], [25.8, 35.15]] }, // Crete
  { h: 0.16, w: 0.25, p: [[32.6, 34.9], [33.3, 34.95]] }, // Troodos
  { h: 0.3, w: 0.3, p: [[22.2, 40.0], [22.4, 40.1]] }, // Olympus
];

// Rivers drawn onto the land (lon/lat polylines)
export const RIVERS = [
  [[30.4, 31.45], [31.0, 30.6], [31.2, 30.1], [31.3, 29.5], [30.9, 28.5], [30.8, 27.5], [31.4, 26.6], [32.6, 25.9], [32.8, 25.0], [32.9, 24.1], [32.9, 23.0], [31.5, 21.8], [30.6, 20.5], [30.4, 19.6], [31.8, 18.6], [32.6, 18.8], [33.6, 17.6], [32.6, 15.6]],
  [[31.85, 31.45], [31.4, 30.8], [31.0, 30.6]],
  [[8.5, 48.0], [10.9, 48.7], [12.3, 49.0], [13.5, 48.6], [16.4, 48.2], [17.7, 47.8], [18.9, 47.8], [18.9, 46.8], [18.9, 45.5], [20.3, 45.1], [21.5, 44.7], [22.6, 44.6], [23.5, 43.8], [25.5, 43.7], [27.5, 44.1], [28.0, 45.4], [29.0, 45.3], [29.7, 45.2]],
  [[9.5, 47.6], [7.6, 47.6], [8.2, 49.0], [8.3, 50.0], [7.6, 50.4], [7.0, 51.0], [6.6, 51.8], [5.5, 51.9], [4.2, 52.0]],
  [[6.2, 46.2], [5.0, 45.9], [4.8, 45.7], [4.8, 44.5], [4.6, 43.7]],
  [[7.3, 44.7], [9.0, 45.1], [10.5, 45.0], [11.7, 45.0], [12.4, 44.95]],
  [[12.1, 43.4], [12.4, 42.6], [12.5, 41.9], [12.25, 41.74]],
  [[4.5, 48.0], [2.4, 48.85], [1.3, 49.3], [0.2, 49.45]],
  [[4.0, 45.0], [3.1, 47.0], [1.9, 47.9], [0.7, 47.4], [-1.5, 47.2], [-2.2, 47.3]],
  [[0.6, 43.2], [1.4, 43.6], [0.5, 44.2], [-0.6, 44.85], [-1.1, 45.6]],
  [[-4.0, 43.0], [-2.4, 42.5], [-0.9, 41.65], [0.9, 40.7]],
  [[-2.0, 40.6], [-4.0, 39.9], [-6.5, 39.6], [-8.4, 39.1], [-9.1, 38.7]],
  [[-3.0, 38.0], [-4.8, 37.9], [-6.0, 37.4], [-6.35, 36.8]],
  [[-1.9, 51.7], [-1.0, 51.5], [0.1, 51.5], [0.7, 51.5]],
  [[38.5, 39.8], [38.6, 37.6], [38.1, 36.9], [38.3, 36.0], [40.1, 35.2], [41.4, 34.4], [43.3, 33.4], [44.4, 32.5], [46.0, 31.1], [47.4, 30.9], [48.3, 30.2]],
  [[40.2, 38.0], [42.2, 37.3], [43.2, 36.3], [43.6, 34.6], [44.4, 33.3], [45.8, 32.5], [47.4, 31.0]],
  [[33.0, 55.0], [30.8, 52.0], [30.5, 50.5], [32.0, 49.4], [35.0, 48.0], [34.0, 47.4], [32.6, 46.6]],
  [[38.0, 53.5], [39.3, 51.5], [41.0, 49.5], [43.5, 48.5], [40.5, 47.5], [39.3, 47.1]],
  [[35.0, 57.0], [40.0, 57.5], [44.0, 56.3], [48.7, 55.8], [49.2, 54.0], [50.0, 53.2], [47.5, 51.5], [46.0, 49.0], [47.8, 47.0], [48.3, 46.3]],
  [[71.0, 37.5], [67.5, 37.2], [65.3, 38.6], [62.3, 40.1], [60.5, 41.5], [59.5, 43.0]],
  [[75.0, 35.0], [72.2, 33.9], [71.5, 32.4], [70.8, 30.0], [69.2, 27.7], [68.4, 25.6], [67.5, 24.1]],
  [[15.0, 50.5], [13.8, 51.0], [12.0, 51.9], [10.5, 53.3], [9.0, 53.9]],
  [[19.9, 50.0], [21.0, 52.0], [18.8, 53.1], [18.8, 54.3]],
  [[17.5, 50.1], [16.5, 51.4], [14.6, 52.6], [14.5, 53.6]],
  [[28.5, 49.5], [29.5, 47.8], [30.2, 46.4]],
];

// Extra sea lanes the automatic strait finder can miss: [cityA, cityB]
export const SEA_LANES = [
  ['Gortyn', 'Sparta'], ['Gortyn', 'Rhodus'], ['Salamis', 'Tarsus'], ['Salamis', 'Antiochia'], ['Salamis', 'Tyrus'],
  ['Carthago', 'Lilybaeum'], ['Carales', 'Carthago'], ['Aleria', 'Genua'], ['Aleria', 'Arretium'], ['Carales', 'Roma'],
  ['Cyrene', 'Gortyn'], ['Alexandria', 'Salamis'], ['Rhodus', 'Halicarnassus'], ['Tara', 'Deva'], ['Scandza', 'Cimbria'],
  ['Scandza', 'Gothiscandza'], ['Londinium', 'Samarobriva'], ['Isca', 'Condate'], ['Athenae', 'Rhodus'],
  ['Lilybaeum', 'Carales'], ['Tingis', 'Gades'], ['Tarentum', 'Ambracia'], ['Byzantium', 'Nicomedia'], ['Panticapaeum', 'Tanais'],
  ['Chersonesus', 'Sinope'], ['Olbia', 'Chersonesus'], ['Syracusae', 'Lilybaeum'], ['Syracusae', 'Rhegium'], ['Mariba', 'Hegra'], ['Mariba', 'Omana'], ['Omana', 'Gerrha'],
];

// Landmarks drawn on the campaign map
export const LANDMARKS = [
  { kind: 'pyramids', lon: 31.13, lat: 29.98 },
  { kind: 'pharos', lon: 29.89, lat: 31.22 },
  { kind: 'colossus', lon: 28.23, lat: 36.45 },
];
