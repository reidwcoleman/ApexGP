// Pine & Dandy: every table the game runs on. Plain TS, no DOM, so Node tools can import it.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** real seconds per month at 1x: winter flies by, the harvest window is the long, loud part of the year */
export const MONTH_SEC = [7, 7, 24, 24, 24, 20, 20, 20, 20, 20, 48, 76];
export const XMAS_DAY = 24;

export interface Species {
  name: string; short: string; rate: number; base: number; seed: number;
  pest: number; drought: number; vol: number; tier: number; unlock: number;
  ramp: [string, string, string, string]; style: 'pine' | 'fir' | 'spruce' | 'noble'; blurb: string;
}
export const SPECIES: Species[] = [
  { name: 'Scotch Pine', short: 'Scotch', rate: 2.5, base: 26, seed: 1, pest: 1.3, drought: 0.3, vol: 0.10, tier: 0, unlock: 0, ramp: ['#1d4a38', '#2f7a47', '#5fa84f', '#a8cf62'], style: 'pine', blurb: 'Fast and tough. Cheap, but it pays the bills.' },
  { name: 'Balsam Fir', short: 'Balsam', rate: 1.8, base: 46, seed: 2, pest: 1, drought: 0.7, vol: 0.12, tier: 0, unlock: 0, ramp: ['#123f38', '#1e6048', '#34845c', '#6db07c'], style: 'fir', blurb: 'The smell of Christmas. Mabel swore by it.' },
  { name: 'Douglas Fir', short: 'Douglas', rate: 2.1, base: 40, seed: 2, pest: 1.1, drought: 0.5, vol: 0.12, tier: 1, unlock: 600, ramp: ['#17503c', '#277a4c', '#46a05c', '#86c872'], style: 'fir', blurb: 'Soft needles, quick to market, sells anywhere.' },
  { name: 'Fraser Fir', short: 'Fraser', rate: 1.45, base: 74, seed: 4, pest: 1.2, drought: 1, vol: 0.14, tier: 2, unlock: 4000, ramp: ['#0f2f3a', '#1a5252', '#2b7a6c', '#5fb096'], style: 'fir', blurb: 'The king of the lot. Slow, thirsty, worth it.' },
  { name: 'Blue Spruce', short: 'Spruce', rate: 1.2, base: 96, seed: 6, pest: 0.7, drought: 0.8, vol: 0.28, tier: 3, unlock: 18000, ramp: ['#1d3a58', '#2f5f86', '#5a96b8', '#b1dae2'], style: 'spruce', blurb: 'Pure fashion. Some years a fortune, some years a shrug.' },
  { name: 'Noble Fir', short: 'Noble', rate: 1.0, base: 150, seed: 10, pest: 0.9, drought: 1.2, vol: 0.16, tier: 4, unlock: 70000, ramp: ['#1b2f4a', '#2a4f6a', '#4a8290', '#92c6bc'], style: 'noble', blurb: 'Strong boughs, huge prices, a very long wait.' },
  { name: 'Aurea Spruce', short: 'Aurea', rate: 0.85, base: 300, seed: 30, pest: 1.6, drought: 1.4, vol: 0.2, tier: 5, unlock: 300000, ramp: ['#6a5418', '#a88a26', '#dcbc3c', '#fbeb96'], style: 'spruce', blurb: 'A golden rarity for people with too much money.' },
];
export const NS = SPECIES.length;

/** size classes: table, small, classic, tall, lobby, grand */
export const SIZE_MIN = [0, 4, 6, 8, 10, 15];
export const SIZE_NAME = ['Table', 'Small', 'Classic', 'Tall', 'Lobby', 'Grand'];
export const SIZE_PRICE = [0.42, 0.74, 1.08, 1.42, 1.72, 2.6];
export const NZ = SIZE_MIN.length;
export const sizeIdx = (h: number) => { for (let i = NZ - 1; i >= 0; i--) if (h >= SIZE_MIN[i]) return i; return 0; };
/** what walk-in families are after */
export const SIZE_DEMAND = [0.08, 0.26, 0.42, 0.18, 0.05, 0.01];
export const MIN_CUT = 2.5;

export const GRADES = [{ n: 'C', min: 0, m: 0.75 }, { n: 'B', min: 45, m: 1 }, { n: 'A', min: 70, m: 1.18 }, { n: 'S', min: 90, m: 1.4 }];
export const gradeOf = (shape: number) => { let g = 0; for (let i = 0; i < GRADES.length; i++) if (shape >= GRADES[i].min) g = i; return g; };

export interface Vehicle { name: string; blurb: string; w: number; speed: number; cap: number; price: number; tier: number; air?: boolean; zoom: number }
export const VEHICLES: Vehicle[] = [
  { name: 'Boots', blurb: "Grandma's. One tree at a time.", w: 1, speed: 6.2, cap: 6, price: 0, tier: 0, zoom: 16 },
  { name: 'Quad Bike', blurb: 'A trailer on the back.', w: 3, speed: 10, cap: 24, price: 1500, tier: 0, zoom: 16 },
  { name: 'Red Tractor', blurb: 'Hauls a proper load.', w: 5, speed: 9.5, cap: 70, price: 9000, tier: 1, zoom: 16 },
  { name: 'Big Jolly', blurb: 'Fields fear it.', w: 9, speed: 10.5, cap: 220, price: 42000, tier: 3, zoom: 8 },
  { name: 'Skycrane', blurb: 'Flies over everything.', w: 15, speed: 21, cap: 700, price: 240000, tier: 4, air: true, zoom: 8 },
];

export interface CrewRank { name: string; w: number; speed: number; cap: number; wage: number; hire: number; tier: number }
export const CREW: CrewRank[] = [
  { name: 'Farmhand', w: 1, speed: 5, cap: 12, wage: 70, hire: 150, tier: 0 },
  { name: 'Quad Crew', w: 3, speed: 8, cap: 36, wage: 220, hire: 900, tier: 1 },
  { name: 'Tractor Crew', w: 5, speed: 8, cap: 90, wage: 620, hire: 6000, tier: 2 },
  { name: 'Jolly Crew', w: 9, speed: 9, cap: 260, wage: 1900, hire: 40000, tier: 3 },
];
export const CREW_NAMES = ['Dot', 'Earl', 'Junie', 'Otis', 'Pearl', 'Hank', 'Wren', 'Gus', 'Birdie', 'Clem', 'Tess', 'Boone', 'Ivy', 'Walt', 'Nell', 'Ike', 'Maude', 'Rusty', 'Fern', 'Abe', 'Lottie', 'Moss', 'Etta', 'Cy', 'Hazel', 'Dale', 'Roxie', 'Vern', 'Sal', 'Tuck'];

export interface BuildingDef { name: string; blurb: string; w: number; h: number; price: number; tier: number; store?: number; unload?: boolean; lot?: number; pull?: number; grow?: number; seedCut?: number; radius?: number; unique?: boolean; fixed?: boolean }
export const BUILDINGS: Record<string, BuildingDef> = {
  house: { name: 'Farmhouse', blurb: "Mabel's place.", w: 5, h: 4, price: 0, tier: 9, fixed: true },
  barn: { name: 'Big Barn', blurb: 'Stores 300. Unload here.', w: 5, h: 4, price: 5000, tier: 1, store: 300, unload: true },
  depot: { name: 'Field Depot', blurb: 'Stores 80. Unload here.', w: 3, h: 2, price: 800, tier: 0, store: 80, unload: true },
  lot: { name: 'Tree Lot', blurb: 'Serves 22 families a day.', w: 6, h: 4, price: 1800, tier: 0, lot: 22 },
  cocoa: { name: 'Cocoa Stand', blurb: '+12% walk-ins.', w: 2, h: 2, price: 900, tier: 0, pull: 0.12 },
  santa: { name: "Santa's Cabin", blurb: '+25% walk-ins.', w: 3, h: 3, price: 6000, tier: 2, pull: 0.25 },
  sleigh: { name: 'Sleigh Rides', blurb: '+40% walk-ins.', w: 4, h: 3, price: 30000, tier: 3, pull: 0.4 },
  sprinkler: { name: 'Sprinkler', blurb: 'Waters 7 tiles around it.', w: 1, h: 1, price: 250, tier: 0, radius: 7 },
  greenhouse: { name: 'Greenhouse', blurb: 'Seedlings -15%, growth +6%.', w: 4, h: 3, price: 7000, tier: 1, grow: 0.06, seedCut: 0.15 },
  kennel: { name: 'Dog Kennel', blurb: 'A dog that chases deer.', w: 2, h: 2, price: 600, tier: 0 },
  helipad: { name: 'Helipad', blurb: 'Stores 500. Skycrane base.', w: 4, h: 4, price: 45000, tier: 4, store: 500, unload: true },
};
export const BUILD_ORDER = ['depot', 'lot', 'cocoa', 'sprinkler', 'kennel', 'barn', 'greenhouse', 'santa', 'sleigh', 'helipad'];

export const TIERS = [
  { name: 'Hobby Plot', sold: 0, demand: 5 },
  { name: 'Family Farm', sold: 100, demand: 11 },
  { name: 'Local Grower', sold: 500, demand: 26 },
  { name: 'Regional Supplier', sold: 1800, demand: 55 },
  { name: 'Tree Baron', sold: 6000, demand: 110 },
  { name: 'Evergreen Legend', sold: 18000, demand: 190 },
];

export const RIVALS = [
  { name: 'Holly Bough Farm', start: 70, cap: 420, grow: 0.09 },
  { name: 'Evergreen Bros', start: 180, cap: 1100, grow: 0.08 },
  { name: 'Pinecrest Co-op', start: 460, cap: 2600, grow: 0.07 },
  { name: 'MegaPine Corp', start: 1500, cap: 6000, grow: 0.06 },
];

export interface Perk { id: string; name: string; text: string }
export const PERKS: Perk[] = [
  { id: 'grow', name: 'Green Thumb', text: 'All trees grow 10% faster.' },
  { id: 'blade', name: 'Sharp Blades', text: 'Shearing improves shape 40% more.' },
  { id: 'lady', name: 'Ladybugs', text: 'Pests spread 35% slower.' },
  { id: 'roots', name: 'Deep Roots', text: 'Droughts hurt half as much.' },
  { id: 'cocoa', name: 'Family Recipe', text: '15% more walk-in families.' },
  { id: 'tongue', name: 'Silver Tongue', text: 'Walk-ins pay 8% more.' },
  { id: 'bulk', name: 'Bulk Seedlings', text: 'Seedlings cost 25% less.' },
  { id: 'diesel', name: 'Cheap Diesel', text: 'You drive 12% faster.' },
  { id: 'hopper', name: 'Bigger Hopper', text: 'You carry 40% more trees.' },
  { id: 'wages', name: 'Good Company', text: 'Wages cost 15% less.' },
  { id: 'early', name: 'Early Bird', text: 'Orders give you 25% more days.' },
  { id: 'tall', name: 'Tall Tales', text: 'Trees over 8 ft pay 20% more.' },
  { id: 'table', name: 'Table Toppers', text: 'Trees under 6 ft pay 40% more.' },
  { id: 'crystal', name: 'Crystal Ball', text: 'Market forecasts get sharper.' },
  { id: 'dump', name: 'Friend at the Depot', text: 'Wholesale pays 15% more.' },
  { id: 'streak', name: 'Second Wind', text: 'One missed order per Rush keeps your Cheer.' },
  { id: 'crew', name: 'Merry Crews', text: 'Crews move 12% faster.' },
  { id: 'land', name: 'County Clerk', text: 'Land costs 12% less.' },
  { id: 'gold', name: 'Lucky Star', text: 'Golden trees show up twice as often.' },
  { id: 'cheer', name: 'Sing-Along', text: 'Each order adds more Cheer.' },
];

export const BUYERS: [number, string[]][] = [
  [1, ['The Hendersons', 'Old Mr. Pruitt', 'Dentist Office', 'Mrs. Abernathy', 'The Corner Diner']],
  [6, ['First Baptist', 'Maple St. School', 'Elks Lodge', 'Rotary Club', 'Fire Station 9']],
  [25, ['Grand Hotel', 'County Courthouse', 'Hilltop Mall', 'City Hall', 'St. Mary Hospital']],
  [90, ['Hardware Chain', 'Food Barn Stores', 'State Fairgrounds', 'Tri-County Lots']],
  [300, ['Mega-Mart Inc.', 'Ski Resort Group', 'Capitol Plaza', 'Northern Railway']],
];
export const HERO_BUYERS = ['The Mayor', 'The Governor', 'Town Square Trust', 'A Movie Studio', 'The Grand Hotel Atrium'];

export interface Goal { text: string; hint: string; cash: number; check: string; n?: number }
/** one long chain from first chop to beating MegaPine; the HUD always shows the next stamp */
export const GOALS: Goal[] = [
  { text: 'Cut 5 trees', hint: 'Walk to the grove and hold SPACE (or hold the mouse).', cash: 0, check: 'cut', n: 5 },
  { text: 'Unload at the barn', hint: 'Walk back to the red barn. Trees unload by themselves.', cash: 0, check: 'unloaded', n: 5 },
  { text: 'Fill your first order', hint: 'Orders appear on the right. Cut what they ask for.', cash: 100, check: 'tickets', n: 1 },
  { text: 'Sell 40 trees', hint: 'The lot opens in late November. Keep the barn stocked.', cash: 300, check: 'sold', n: 40 },
  { text: 'Get through your first Christmas', hint: 'Sell all you can before Dec 24.', cash: 0, check: 'year', n: 2 },
  { text: 'Plant 30 seedlings', hint: 'Spring is planting time. Press 2, hold SPACE on empty ground.', cash: 150, check: 'planted', n: 30 },
  { text: 'Buy the Quad Bike', hint: 'Open SHOP. Three rows at a time.', cash: 0, check: 'veh', n: 1 },
  { text: 'Shear 20 trees', hint: 'June to September. Press 3. Better shape, better grade.', cash: 200, check: 'sheared', n: 20 },
  { text: 'Buy a new parcel', hint: 'Open LAND and click a parcel next to yours.', cash: 200, check: 'parcels', n: 3 },
  { text: 'Draw a block', hint: 'Press B, then drag a rectangle. Blocks are orders for crews.', cash: 200, check: 'blocks', n: 1 },
  { text: 'Hire a farmhand', hint: 'Open CREW. Hands work your blocks by themselves.', cash: 200, check: 'crew', n: 1 },
  { text: 'Fill 5 orders in one Rush', hint: 'Every order on time raises your Cheer.', cash: 800, check: 'yrTickets', n: 5 },
  { text: 'Keep 500 trees standing', hint: 'Plant more than you cut.', cash: 1000, check: 'standing', n: 500 },
  { text: 'Buy the Red Tractor', hint: 'Five rows at a time. Open SHOP.', cash: 0, check: 'veh', n: 2 },
  { text: 'Sell 300 trees in one year', hint: 'A second lot and a depot help.', cash: 2500, check: 'yrSold', n: 300 },
  { text: 'Unlock Fraser Fir', hint: 'Open CATALOG in the MARKET window.', cash: 2000, check: 'species', n: 3 },
  { text: 'Reach a Cheer streak of 8', hint: 'Fill 8 orders in a row without missing one.', cash: 5000, check: 'bestStreak', n: 8 },
  { text: 'Own 12 parcels', hint: 'Good soil grows faster. Look before you buy.', cash: 6000, check: 'parcels', n: 12 },
  { text: 'Run 5 crews', hint: 'Crews take strips from any block with work.', cash: 6000, check: 'crew', n: 5 },
  { text: 'Beat Holly Bough Farm', hint: 'Sell more trees in a year than they do.', cash: 10000, check: 'rank', n: 4 },
  { text: 'Keep 3,000 trees standing', hint: 'Mix species. Pests love one big field.', cash: 15000, check: 'standing', n: 3000 },
  { text: 'Sell 1,000 trees in one year', hint: 'You will need trucks of people. Build up the lot.', cash: 25000, check: 'yrSold', n: 1000 },
  { text: 'Buy Big Jolly', hint: 'Nine rows at once.', cash: 0, check: 'veh', n: 3 },
  { text: 'Beat Pinecrest Co-op', hint: 'Sell more than third place.', cash: 60000, check: 'rank', n: 2 },
  { text: 'Keep 10,000 trees standing', hint: 'Zoom right out and enjoy it.', cash: 80000, check: 'standing', n: 10000 },
  { text: 'Sell 3,000 trees in one year', hint: 'Now you are a real problem for MegaPine.', cash: 150000, check: 'yrSold', n: 3000 },
  { text: 'Buy the Skycrane', hint: 'Needs a Helipad to unload big.', cash: 0, check: 'veh', n: 4 },
  { text: 'Beat MegaPine Corp', hint: 'Be the biggest tree farm in the country.', cash: 500000, check: 'rank', n: 1 },
  { text: 'Keep 25,000 trees standing', hint: 'The whole county is yours.', cash: 1000000, check: 'standing', n: 25000 },
];

export const LETTERS: Record<string, string[]> = {
  buck0: ['Heard you took over the old Mabel place.', 'Cute little patch. When it gets too much,', 'MegaPine pays cash.', '', '- Buck Hemlock, President, MegaPine Corp.'],
  buck1: ['You sold a few trees. Well done.', 'I sold that many before breakfast.', 'My offer gets smaller every year.', '', '- Buck Hemlock'],
  buck2: ['Three of my buyers asked about you.', 'I do not enjoy that.', 'Name your price. Please.', '', '- Buck Hemlock'],
  buck3: ['Fine. You are bigger than us this year.', 'Mabel always said you would be trouble.', 'She meant it kindly. I do not.', 'Merry Christmas.', '- Buck'],
};

// ---- the fun layer: combos, gifts, the Advent Album ---------------------------------------------------------
/** combo thresholds are for Boots; wider machines need more trees for the same word */
export const COMBO_TIERS: [number, string, number][] = [[6, 'NICE', 10], [12, 'JOLLY!', 25], [24, 'MERRY!', 60], [45, 'FESTIVE!', 150], [80, 'YULETASTIC!', 400], [140, 'LEGEND OF THE NORTH', 1000]];
/** the chorus of Jingle Bells, one note a bell */
export const TRAIL_NOTES = [76, 76, 76, 76, 76, 76, 76, 79, 72, 74, 76, 77, 77, 77, 77, 77, 76, 76, 76, 79, 79, 77, 74, 72];
export const JOLLY_SECS = 10;

export interface Ornament { name: string; shape: 'ball' | 'bell' | 'star' | 'cane' | 'flake' | 'man' | 'sock' | 'drum'; col: string; hi: string; note: string }
export const ORNAMENTS: Ornament[] = [
  { name: 'Red Glass Ball', shape: 'ball', col: '#e0262f', hi: '#ff8f86', note: 'Older than the barn.' },
  { name: 'Brass Bell', shape: 'bell', col: '#ffc92e', hi: '#fff09a', note: 'Rings if you sneeze.' },
  { name: 'Tin Star', shape: 'star', col: '#c0c4d8', hi: '#fdfcf6', note: 'Cut from a coffee can, 1961.' },
  { name: 'Peppermint Cane', shape: 'cane', col: '#e0262f', hi: '#fdfcf6', note: 'Do not lick. Someone did.' },
  { name: 'Paper Snowflake', shape: 'flake', col: '#fdfcf6', hi: '#cfe9fb', note: 'No two alike. This one is lopsided.' },
  { name: 'Gingerbread Gus', shape: 'man', col: '#a8683a', hi: '#e0b67a', note: 'He has seen things.' },
  { name: 'Tiny Stocking', shape: 'sock', col: '#e0262f', hi: '#fdfcf6', note: 'Holds exactly one peanut.' },
  { name: 'Toy Drum', shape: 'drum', col: '#2f7ae0', hi: '#ffc92e', note: 'Pa rum pum pum pum.' },
  { name: 'Green Glass Ball', shape: 'ball', col: '#279050', hi: '#bfe254', note: 'Survived three cats.' },
  { name: 'Silver Bell', shape: 'bell', col: '#c0c4d8', hi: '#fdfcf6', note: 'Soon it will be Christmas Day.' },
  { name: 'Gold Star', shape: 'star', col: '#ffc92e', hi: '#fff09a', note: 'For the top. Mabel insists.' },
  { name: 'Mint Cane', shape: 'cane', col: '#279050', hi: '#fdfcf6', note: 'The controversial flavor.' },
  { name: 'Frost Flake', shape: 'flake', col: '#79bcf2', hi: '#fdfcf6', note: 'Melts if you are smug about it.' },
  { name: 'Gingerbread Dot', shape: 'man', col: '#c88a56', hi: '#ff8f86', note: 'Runs the place, really.' },
  { name: 'Knit Stocking', shape: 'sock', col: '#279050', hi: '#ffc92e', note: 'Mabel knit one. Only one.' },
  { name: 'Red Drum', shape: 'drum', col: '#e0262f', hi: '#ffc92e', note: 'The elves banned it.' },
  { name: 'Blue Glass Ball', shape: 'ball', col: '#2f7ae0', hi: '#a4dcff', note: 'You can see the whole farm in it.' },
  { name: 'Sleigh Bell', shape: 'bell', col: '#e0309a', hi: '#ffa0d8', note: 'Fell off something fast.' },
  { name: 'Northern Star', shape: 'star', col: '#58d2b8', hi: '#fdfcf6', note: 'Points to the good pie.' },
  { name: 'Licorice Cane', shape: 'cane', col: '#44285e', hi: '#c0c4d8', note: 'Nobody asked for this.' },
  { name: 'Golden Flake', shape: 'flake', col: '#ffc92e', hi: '#fff09a', note: 'Worth nothing. Priceless.' },
  { name: 'Gingerbread Buck', shape: 'man', col: '#6a3d2a', hi: '#8f92ac', note: 'Tastes like corporate greed.' },
  { name: 'Baby Stocking', shape: 'sock', col: '#ff8f86', hi: '#fdfcf6', note: 'Yours, from your first Christmas.' },
  { name: "Mabel's Angel", shape: 'star', col: '#fff09a', hi: '#fdfcf6', note: 'She saved this one for you.' },
];
export const MABEL_NOTES = ['Mabel: Eat something. You look thin.', 'Mabel: The firs like it when you hum.', 'Mabel: Never trust a man with a lanyard.', 'Mabel: There is pie in the freezer. Do not ask how old.', 'Mabel: Rotate your crops. Rotate your socks.', 'Mabel: Buck Hemlock cried at my wedding. Not from joy.'];
export const COAL_NOTES = ['A lump of coal, from Buck Hemlock.', 'Coal. The card says "Regards, MegaPine".', 'Coal, gift wrapped by a junior associate.'];
export const ELF_LINES = ['Fir real!', 'Spruce it up!', 'Tree-mendous!', 'Yule love it!', 'Needle a hand?', 'Pine-tastic!', 'Snow way!', 'Happy holly days!', 'Oh, fir crying out loud', 'Have a holly jolly', 'Tinsel in my boots', 'Lookin sharp, boss', 'Union rep says hi', 'Wood you believe it', 'I wood not leaf', 'Bough down!'];
export const FAMILY_LINES = ['This one!', 'Its so big!', 'It will fit. Probably.', 'Smells like Christmas', 'Can we keep the elf?', 'Dad, it wont fit', 'Best tree ever!', 'Merry Christmas!', 'Mom said smaller', 'I named it Doug'];

// Buck Hemlock turns up in person when the farm is quiet
export const DUEL_GATES = 9;
export const BUCK_DARE = ['Think you can keep up, kiddo?', 'My accountant drives faster than you.', 'First to the flag. Unless you are scared.', 'Your grandma raced better. In boots.', 'Race me. Shareholders love a blowout.'];
export const BUCK_WINS = ['MegaPine always delivers.', 'Try a bicycle.', 'That was my slow truck.', 'I will send you a brochure.'];
export const BUCK_LOSES = ['My tires were cold.', 'I let you win. Legal made me.', 'This changes nothing. Probably.', 'Who taught you to drive?!'];
