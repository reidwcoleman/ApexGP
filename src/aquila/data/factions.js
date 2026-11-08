// Factions of the known world, c. 272 BC. Only Rome is playable.
// culture picks the unit roster, city architecture and general names.

export const FACTIONS = {
  rome:     { name: 'Rome',              adj: 'Roman',       color: '#b81f2a', culture: 'roman',    capital: 'Roma',          aggression: 0.0, major: true },
  carthage: { name: 'Carthage',          adj: 'Carthaginian',color: '#8a3aa6', culture: 'punic',    capital: 'Carthago',      aggression: 0.55, major: true },
  gaul:     { name: 'The Arverni',       adj: 'Gallic',      color: '#3c8a3a', culture: 'gallic',   capital: 'Gergovia',      aggression: 0.6, major: true },
  britons:  { name: 'The Brigantes',     adj: 'Briton',      color: '#2a9a94', culture: 'briton',   capital: 'Eboracum',      aggression: 0.4, major: true },
  germans:  { name: 'The Suebi',         adj: 'Germanic',    color: '#4d5866', culture: 'german',   capital: 'Semnonia',      aggression: 0.65, major: true },
  iberia:   { name: 'The Arevaci',       adj: 'Iberian',     color: '#dd7a1f', culture: 'iberian',  capital: 'Numantia',      aggression: 0.45, major: true },
  macedon:  { name: 'Macedon',           adj: 'Macedonian',  color: '#2b4fb5', culture: 'hellenic', capital: 'Pella',         aggression: 0.5, major: true },
  greeks:   { name: 'The Hellenic League',adj: 'Greek',      color: '#5aaee0', culture: 'hellenic', capital: 'Athenae',       aggression: 0.35, major: true },
  seleucid: { name: 'The Seleucid Empire',adj: 'Seleucid',   color: '#e2bf35', culture: 'seleucid', capital: 'Antiochia',     aggression: 0.55, major: true },
  egypt:    { name: 'Ptolemaic Egypt',   adj: 'Egyptian',    color: '#cf3f8f', culture: 'ptolemaic',capital: 'Alexandria',    aggression: 0.4, major: true },
  parthia:  { name: 'Parthia',           adj: 'Parthian',    color: '#5b3fae', culture: 'eastern',  capital: 'Hecatompylos',  aggression: 0.6, major: true },
  dacia:    { name: 'Dacia',             adj: 'Dacian',      color: '#b89a5e', culture: 'dacian',   capital: 'Sarmizegetusa', aggression: 0.55, major: true },
  numidia:  { name: 'Numidia',           adj: 'Numidian',    color: '#9cb941', culture: 'african',  capital: 'Cirta',         aggression: 0.45, major: true },
  scythia:  { name: 'Scythia',           adj: 'Scythian',    color: '#8b5a3a', culture: 'steppe',   capital: 'Gerrhus',       aggression: 0.6, major: true },
  free:     { name: 'Free Peoples',      adj: 'Independent', color: '#8d8a82', culture: 'local',    capital: null,            aggression: 0, major: false },
};

export const FACTION_IDS = Object.keys(FACTIONS);

// Rome's titles, earned by holding provinces. Each unlocks units and a bonus.
export const RANKS = [
  { at: 0,  title: 'Res Publica',            note: 'A republic of Latium, hemmed in by rivals.' },
  { at: 8,  title: 'Mistress of Italia',      note: 'Auxiliary archers and heavier cavalry join the levy.' },
  { at: 20, title: 'Mare Nostrum',            note: 'The Marian Reforms: professional Legionaries with Testudo.' },
  { at: 38, title: 'Imperator',               note: 'The Praetorian Cohorts answer your call.' },
  { at: 60, title: 'Augustus of the World',   note: 'Every road leads to Rome.' },
];

export function rankFor(n) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (n >= RANKS[i].at) r = i;
  return r;
}

const NAMES = {
  roman: {
    a: ['Gaius', 'Lucius', 'Marcus', 'Publius', 'Quintus', 'Titus', 'Gnaeus', 'Aulus', 'Servius', 'Decimus', 'Manius', 'Spurius'],
    b: ['Cornelius', 'Fabius', 'Claudius', 'Julius', 'Aemilius', 'Valerius', 'Junius', 'Sempronius', 'Licinius', 'Caecilius', 'Postumius', 'Furius', 'Manlius', 'Sulpicius'],
    c: ['Scipio', 'Maximus', 'Nero', 'Caesar', 'Paullus', 'Flaccus', 'Brutus', 'Gracchus', 'Crassus', 'Metellus', 'Albinus', 'Camillus', 'Torquatus', 'Galba', 'Rufus', 'Varro'],
  },
  punic: { a: ['Hannibal', 'Hasdrubal', 'Hamilcar', 'Mago', 'Hanno', 'Bomilcar', 'Himilco', 'Adherbal', 'Gisco', 'Maharbal'], b: ['Barca', 'the Elder', 'son of Gisco', 'the Bold', 'of Utica', 'the Great'] },
  gallic: { a: ['Vercingetorix', 'Brennus', 'Ambiorix', 'Dumnorix', 'Orgetorix', 'Commius', 'Litaviccus', 'Vercassivellaunus', 'Lucterius', 'Diviciacus'], b: ['of the Arverni', 'the Tall', 'the Fierce', 'of the Aedui', 'Ironhand'] },
  briton: { a: ['Cassivellaunus', 'Caratacus', 'Togodumnus', 'Cunobelinus', 'Venutius', 'Prasutagus', 'Mandubracius'], b: ['of the Brigantes', 'the Painted', 'of the Iceni', 'Wolfcloak'] },
  german: { a: ['Ariovistus', 'Arminius', 'Maroboduus', 'Boiorix', 'Teutobod', 'Segimer', 'Inguiomer', 'Catumer'], b: ['of the Suebi', 'the Wolf', 'of the Cherusci', 'Spear-Breaker'] },
  iberian: { a: ['Viriathus', 'Indibilis', 'Mandonius', 'Istolatios', 'Caros', 'Megara', 'Retogenes'], b: ['of Numantia', 'the Shepherd', 'of the Ilergetes', 'the Unbroken'] },
  hellenic: { a: ['Antigonus', 'Demetrius', 'Philip', 'Pyrrhus', 'Kleomenes', 'Aratus', 'Philopoemen', 'Lysimachus', 'Perseus', 'Agathocles'], b: ['Gonatas', 'the Besieger', 'of Epirus', 'of Sparta', 'the Strategos', 'Doson'] },
  seleucid: { a: ['Antiochus', 'Seleucus', 'Achaeus', 'Molon', 'Demetrius', 'Nicanor'], b: ['Soter', 'the Great', 'Callinicus', 'Theos', 'Keraunos'] },
  ptolemaic: { a: ['Ptolemy', 'Sosibius', 'Scopas', 'Agathocles', 'Magas', 'Andromachus'], b: ['Philadelphus', 'Euergetes', 'of Cyrene', 'Soter', 'the Younger'] },
  eastern: { a: ['Arsaces', 'Tiridates', 'Mithridates', 'Phraates', 'Surena', 'Orodes', 'Artabanus'], b: ['the Archer', 'of Nisa', 'the Rider', 'Philhellen', 'of the Parni'] },
  dacian: { a: ['Burebista', 'Decebalus', 'Dromichaetes', 'Rubobostes', 'Oroles', 'Diegis'], b: ['of the Getae', 'the Wolf', 'Falx-Bearer', 'of the Carpi'] },
  african: { a: ['Masinissa', 'Syphax', 'Gala', 'Jugurtha', 'Micipsa', 'Gulussa', 'Bocchus'], b: ['of the Massyli', 'the Rider', 'of Cirta', 'of Mauretania'] },
  steppe: { a: ['Ateas', 'Skilurus', 'Palakos', 'Spargapises', 'Idanthyrsus', 'Saitaphernes'], b: ['of the Royal Scyths', 'Gold-Belt', 'the Horse-Lord', 'of the Iazyges'] },
  local: { a: ['Teuta', 'Agron', 'Bato', 'Genthius', 'Tarcondimotus', 'Ariarathes', 'Zipoetes', 'Attalus'], b: ['the Chieftain', 'the Elder', 'of the Hills', 'the King'] },
};

export function generalName(culture, rng = Math.random) {
  const n = NAMES[culture] || NAMES.local;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (n.c) return `${pick(n.a)} ${pick(n.b)} ${pick(n.c)}`;
  return `${pick(n.a)} ${pick(n.b)}`;
}
