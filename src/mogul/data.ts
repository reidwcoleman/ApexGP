// Mogul's economy tables: goods, the cart menu, shops, facilities, ore, rivals and the goal chain.
// Every number the game balances on lives here.

export type GoodId =
  | 'wheat' | 'veg' | 'fruit' | 'milk' | 'meat' | 'beans'
  | 'flour' | 'bread'
  | 'stone' | 'coal' | 'iron' | 'copper' | 'gold'
  | 'steel' | 'bricks' | 'electronics' | 'jewelry';

export interface Good { id: GoodId; name: string; price: number; color: string; cat: 'food' | 'raw' | 'ore' | 'made'; vol: number }

export const GOODS: Record<GoodId, Good> = {
  wheat: { id: 'wheat', name: 'Wheat', price: 4, color: '#e8b44a', cat: 'raw', vol: 0.03 },
  veg: { id: 'veg', name: 'Vegetables', price: 6, color: '#58b85a', cat: 'raw', vol: 0.04 },
  fruit: { id: 'fruit', name: 'Fruit', price: 7, color: '#ff7a59', cat: 'raw', vol: 0.04 },
  milk: { id: 'milk', name: 'Milk', price: 5, color: '#cfe3f5', cat: 'raw', vol: 0.03 },
  meat: { id: 'meat', name: 'Meat', price: 12, color: '#d9534f', cat: 'raw', vol: 0.04 },
  beans: { id: 'beans', name: 'Coffee Beans', price: 15, color: '#7a4a2a', cat: 'raw', vol: 0.06 },
  flour: { id: 'flour', name: 'Flour', price: 8, color: '#f3ead8', cat: 'made', vol: 0.03 },
  bread: { id: 'bread', name: 'Bread', price: 14, color: '#c98a3c', cat: 'made', vol: 0.04 },
  stone: { id: 'stone', name: 'Stone', price: 3, color: '#a8a8a0', cat: 'ore', vol: 0.02 },
  coal: { id: 'coal', name: 'Coal', price: 6, color: '#3b3b40', cat: 'ore', vol: 0.05 },
  iron: { id: 'iron', name: 'Iron Ore', price: 9, color: '#b5643c', cat: 'ore', vol: 0.05 },
  copper: { id: 'copper', name: 'Copper Ore', price: 14, color: '#d98b4a', cat: 'ore', vol: 0.06 },
  gold: { id: 'gold', name: 'Gold Ore', price: 90, color: '#ffcc33', cat: 'ore', vol: 0.08 },
  steel: { id: 'steel', name: 'Steel', price: 30, color: '#8fa3b8', cat: 'made', vol: 0.05 },
  bricks: { id: 'bricks', name: 'Bricks', price: 7, color: '#c4553b', cat: 'made', vol: 0.03 },
  electronics: { id: 'electronics', name: 'Electronics', price: 95, color: '#4aa8ff', cat: 'made', vol: 0.07 },
  jewelry: { id: 'jewelry', name: 'Jewelry', price: 260, color: '#e86bd8', cat: 'made', vol: 0.09 },
};
export const GOOD_IDS = Object.keys(GOODS) as GoodId[];

/** hours 0..23 → demand multiplier shapes */
export type Peak = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night' | 'allday';
export function peakMul(p: Peak, h: number): number {
  const g = (c: number, w: number) => { const d = ((h - c + 36) % 24) - 12; return Math.exp(-(d * d) / (2 * w * w)); };
  switch (p) {
    case 'morning': return 0.45 + 1.3 * g(8, 1.6);
    case 'lunch': return 0.5 + 1.2 * g(12.5, 1.5);
    case 'afternoon': return 0.5 + 1.1 * g(15.5, 2.2);
    case 'evening': return 0.5 + 1.2 * g(19, 2);
    case 'night': return 0.4 + 1.4 * g(22.5, 2.2);
    default: return 1;
  }
}

export interface MenuItem { id: string; name: string; fair: number; good: GoodId; use: number; peak: Peak; color: string }
export const MENU: MenuItem[] = [
  { id: 'hotdog', name: 'Hot Dogs', fair: 5, good: 'meat', use: 0.1, peak: 'lunch', color: '#e5533d' },
  { id: 'coffee', name: 'Coffee', fair: 4, good: 'beans', use: 0.05, peak: 'morning', color: '#7a4a2a' },
  { id: 'pretzel', name: 'Pretzels', fair: 3.5, good: 'flour', use: 0.08, peak: 'afternoon', color: '#c98a3c' },
  { id: 'taco', name: 'Tacos', fair: 6, good: 'veg', use: 0.12, peak: 'night', color: '#f2b134' },
  { id: 'lemonade', name: 'Lemonade', fair: 3, good: 'fruit', use: 0.08, peak: 'afternoon', color: '#ffe14d' },
  { id: 'icecream', name: 'Ice Cream', fair: 4.5, good: 'milk', use: 0.12, peak: 'afternoon', color: '#ff9ec4' },
  { id: 'dumpling', name: 'Dumplings', fair: 6.5, good: 'flour', use: 0.12, peak: 'evening', color: '#f3ead8' },
  { id: 'crepe', name: 'Crêpes', fair: 7, good: 'milk', use: 0.1, peak: 'evening', color: '#ffcf8a' },
];
export const MENU_BY: Record<string, MenuItem> = Object.fromEntries(MENU.map((m) => [m.id, m]));

export interface ShopType { id: string; name: string; color: string; fitout: number; items: MenuItem[] }
const P = (id: string, name: string, fair: number, good: GoodId, use: number, peak: Peak, color: string): MenuItem => ({ id, name, fair, good, use, peak, color });
export const SHOPS: ShopType[] = [
  { id: 'cafe', name: 'Café', color: '#a8673a', fitout: 900, items: [P('latte', 'Lattes', 6.5, 'beans', 0.06, 'morning', '#a8673a'), P('croissant', 'Croissants', 5, 'bread', 0.15, 'morning', '#e0a050')] },
  { id: 'bakery', name: 'Bakery', color: '#e0a050', fitout: 1100, items: [P('loaf', 'Loaves', 8, 'bread', 0.3, 'allday', '#c98a3c'), P('cake', 'Cakes', 14, 'flour', 0.3, 'afternoon', '#ff9ec4')] },
  { id: 'grocer', name: 'Grocery', color: '#58b85a', fitout: 1400, items: [P('produce', 'Produce', 14, 'veg', 0.8, 'allday', '#58b85a'), P('fruitbox', 'Fruit', 12, 'fruit', 0.7, 'afternoon', '#ff7a59'), P('milkjug', 'Milk', 7, 'milk', 0.6, 'morning', '#cfe3f5')] },
  { id: 'diner', name: 'Diner', color: '#e5533d', fitout: 2600, items: [P('burger', 'Burgers', 17, 'meat', 0.25, 'lunch', '#e5533d'), P('sandwich', 'Sandwiches', 13, 'bread', 0.25, 'lunch', '#e0a050')] },
  { id: 'tech', name: 'Tech Store', color: '#4aa8ff', fitout: 9000, items: [P('phone', 'Gadgets', 240, 'electronics', 1.4, 'afternoon', '#4aa8ff')] },
  { id: 'jeweler', name: 'Jeweler', color: '#e86bd8', fitout: 16000, items: [P('ring', 'Rings', 700, 'jewelry', 1.6, 'evening', '#e86bd8')] },
  { id: 'hardware', name: 'Hardware', color: '#8fa3b8', fitout: 5000, items: [P('tools', 'Tools', 85, 'steel', 1.5, 'morning', '#8fa3b8'), P('brickpack', 'Building supplies', 30, 'bricks', 2.5, 'allday', '#c4553b')] },
];
export const SHOP_BY: Record<string, ShopType> = Object.fromEntries(SHOPS.map((s) => [s.id, s]));

export interface Recipe { inp: Partial<Record<GoodId, number>>; out: Partial<Record<GoodId, number>> } // per game hour at level 1
export interface FacilityType { id: string; name: string; group: 'farm' | 'factory' | 'home' | 'store'; color: string; h: number; cost: number; mats: Partial<Record<GoodId, number>>; recipe?: Recipe; wage: number; blurb: string; rent?: number; cap: number }
export const FACILITIES: FacilityType[] = [
  { id: 'grain', name: 'Rooftop Grain Farm', group: 'farm', color: '#e8c45a', h: 8, cost: 6000, mats: { bricks: 20 }, recipe: { inp: {}, out: { wheat: 14 } }, wage: 60, blurb: 'Grows wheat for mills.', cap: 300 },
  { id: 'greenhouse', name: 'Greenhouse', group: 'farm', color: '#8fe0b0', h: 9, cost: 9000, mats: { steel: 10, bricks: 10 }, recipe: { inp: {}, out: { veg: 9, fruit: 7 } }, wage: 90, blurb: 'Vegetables and fruit, all year round.', cap: 300 },
  { id: 'dairy', name: 'Urban Dairy', group: 'farm', color: '#f4f1e8', h: 8, cost: 8000, mats: { bricks: 30 }, recipe: { inp: {}, out: { milk: 12 } }, wage: 80, blurb: 'Milk for ice cream, crêpes and cafés.', cap: 300 },
  { id: 'ranch', name: 'Meat Packer', group: 'farm', color: '#d98a7a', h: 10, cost: 12000, mats: { bricks: 30, steel: 10 }, recipe: { inp: {}, out: { meat: 7 } }, wage: 110, blurb: 'Meat for hot dogs, burgers and dumplings.', cap: 300 },
  { id: 'mill', name: 'Flour Mill', group: 'factory', color: '#f0dfb8', h: 16, cost: 10000, mats: { bricks: 40, steel: 10 }, recipe: { inp: { wheat: 10 }, out: { flour: 9 } }, wage: 90, blurb: 'Wheat in, flour out.', cap: 400 },
  { id: 'bakeryplant', name: 'Bread Factory', group: 'factory', color: '#e0a050', h: 14, cost: 16000, mats: { bricks: 40, steel: 20 }, recipe: { inp: { flour: 6, milk: 2 }, out: { bread: 9 } }, wage: 140, blurb: 'Flour and milk into bread by the crate.', cap: 400 },
  { id: 'brickworks', name: 'Brickworks', group: 'factory', color: '#c4553b', h: 12, cost: 7000, mats: { stone: 40 }, recipe: { inp: { stone: 12 }, out: { bricks: 10 } }, wage: 70, blurb: 'Stone into bricks. Everything is built from them.', cap: 400 },
  { id: 'foundry', name: 'Steel Foundry', group: 'factory', color: '#6f7f90', h: 22, cost: 30000, mats: { bricks: 120 }, recipe: { inp: { iron: 8, coal: 5 }, out: { steel: 6 } }, wage: 260, blurb: 'Iron and coal into steel.', cap: 400 },
  { id: 'chipfab', name: 'Electronics Plant', group: 'factory', color: '#4aa8ff', h: 18, cost: 90000, mats: { steel: 80, bricks: 80 }, recipe: { inp: { copper: 5, steel: 2 }, out: { electronics: 4 } }, wage: 600, blurb: 'Copper and steel into gadgets. Big money.', cap: 300 },
  { id: 'atelier', name: 'Jewelry Atelier', group: 'factory', color: '#e86bd8', h: 12, cost: 140000, mats: { steel: 40, bricks: 60 }, recipe: { inp: { gold: 2 }, out: { jewelry: 3 } }, wage: 900, blurb: 'Gold into rings. The richest trade in town.', cap: 200 },
  { id: 'apartments', name: 'Apartments', group: 'home', color: '#ffd9a8', h: 30, cost: 45000, mats: { bricks: 200, steel: 40 }, wage: 0, rent: 1400, blurb: 'Tenants pay rent every day, and fill the streets with customers.', cap: 0 },
  { id: 'warehouse', name: 'Warehouse', group: 'store', color: '#b9a37c', h: 10, cost: 5000, mats: { bricks: 30 }, wage: 20, blurb: 'Holds 1,500 units for your truck network.', cap: 1500 },
];
export const FAC_BY: Record<string, FacilityType> = Object.fromEntries(FACILITIES.map((f) => [f.id, f]));

export interface OreType { id: GoodId; name: string; weight: number; amount: [number, number]; rate: number; claim: number }
export const ORES: OreType[] = [
  { id: 'stone', name: 'Stone', weight: 5, amount: [3000, 8000], rate: 22, claim: 2500 },
  { id: 'coal', name: 'Coal', weight: 4, amount: [2000, 6000], rate: 16, claim: 4000 },
  { id: 'iron', name: 'Iron', weight: 3.5, amount: [2000, 5000], rate: 14, claim: 6000 },
  { id: 'copper', name: 'Copper', weight: 2.2, amount: [1500, 4000], rate: 10, claim: 12000 },
  { id: 'gold', name: 'Gold', weight: 0.8, amount: [400, 1200], rate: 4, claim: 30000 },
];
export const ORE_BY: Record<string, OreType> = Object.fromEntries(ORES.map((o) => [o.id, o]));

export const RIVALS = [
  { name: 'Bluebird Holdings', color: '#4a7dff' },
  { name: 'Marigold & Sons', color: '#ffb02e' },
  { name: 'Halcyon Group', color: '#38c7b0' },
  { name: 'Ironbark Capital', color: '#8a6cff' },
  { name: 'Petal Street Co.', color: '#ff6fae' },
  { name: 'Northwind Trading', color: '#5fb4e8' },
  { name: 'Copperline Ventures', color: '#e07a3a' },
  { name: 'Juniper Partners', color: '#6fbf4a' },
  { name: 'Lantern Bay Inc.', color: '#e8c33a' },
];

// --- timing ---
export const SEC_PER_HOUR = 10; // real seconds per game hour
export const DAYS_PER_MONTH = 7;
export const START_CASH = 600;

export const CART_COST = (n: number) => (n <= 0 ? 0 : Math.round(220 * Math.pow(1.45, n - 1)));
export const TRUCK_COST = (n: number) => Math.round(2500 * Math.pow(1.18, n));
export const SURVEY_COST = (n: number) => Math.round(150 * Math.pow(1.12, n));
export const CART_UP = { speed: [0, 150, 450, 1200, 3200], sign: [0, 120, 380, 1000, 2800], style: [0, 200, 600, 1600, 4200] };
export const SHOP_UP = { crew: [0, 800, 2400, 7000, 20000], decor: [0, 600, 1800, 5200, 15000], ads: [0, 500, 1500, 4500, 13000] };
export const FAC_UP = [0, 0.6, 1.4, 3, 6]; // × facility cost for each level
export const TRUCK_CAP = 40;
export const COURIER_FEE = 0.1;

export interface Quest { id: string; text: string; hint: string; reward: number }
export const QUESTS: Quest[] = [
  { id: 'cart1', text: 'Park your first food cart', hint: 'Pick the cart in the dock, then a busy street. Brighter streets = more people.', reward: 100 },
  { id: 'serve10', text: 'Serve 10 customers', hint: 'Click your cart when a line forms to serve faster.', reward: 150 },
  { id: 'menu2', text: 'Add a second item to the menu', hint: 'Select your cart. Coffee sells in the morning, tacos at night.', reward: 150 },
  { id: 'earn1k', text: 'Make $1,000 in sales', hint: 'Fair prices keep the line long. Too high and people walk past.', reward: 250 },
  { id: 'cart2', text: 'Run 2 carts', hint: 'Spread out: two carts on one corner split the crowd.', reward: 300 },
  { id: 'upgrade', text: 'Upgrade a cart', hint: 'A faster grill or a bigger sign pays for itself fast.', reward: 300 },
  { id: 'shop', text: 'Rent a room and open a shop', hint: 'Click any building to see its ground-floor rooms.', reward: 800 },
  { id: 'survey', text: 'Survey for buried ore', hint: 'Survey tool: click the map. Only you can see what you find.', reward: 500 },
  { id: 'quarry', text: 'Stake a quarry on a deposit', hint: 'Stone is cheap to claim, gold is a jackpot.', reward: 1500 },
  { id: 'sell100', text: 'Sell 100 units on the Exchange', hint: 'Open the Exchange from the dock.', reward: 1200 },
  { id: 'building', text: 'Buy a whole building', hint: 'Small buildings away from the busy avenues are cheaper.', reward: 3000 },
  { id: 'truck', text: 'Buy your first truck', hint: 'Trucks haul between your buildings on their own, no routes needed.', reward: 2000 },
  { id: 'facility', text: 'Build a farm or a factory', hint: 'Select a building you own and redevelop it.', reward: 5000 },
  { id: 'nw100k', text: 'Reach $100,000 net worth', hint: 'Chains pay: quarry → factory → shop.', reward: 10000 },
  { id: 'top3', text: 'Finish a month in the top 3', hint: 'The leaderboard ranks this month\'s growth.', reward: 25000 },
  { id: 'nw1m', text: 'Reach $1,000,000 net worth', hint: 'Electronics and jewelry are the big earners.', reward: 60000 },
  { id: 'nw10m', text: 'Reach $10,000,000 net worth', hint: 'Own the skyline.', reward: 300000 },
];

export const TIERS = [
  { min: 0, name: 'Street Vendor', color: '#c9b79c' },
  { min: 10000, name: 'Shopkeeper', color: '#cd7f32' },
  { min: 100000, name: 'Proprietor', color: '#c0c7d2' },
  { min: 1000000, name: 'Tycoon', color: '#ffc83d' },
  { min: 10000000, name: 'Magnate', color: '#7ff0e0' },
  { min: 100000000, name: 'Mogul', color: '#ff5fd2' },
];
export const tierOf = (nw: number) => TIERS.reduce((a, t) => (nw >= t.min ? t : a), TIERS[0]);
