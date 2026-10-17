// ─────────────────────────────────────────────────────────────
//  Billboard Insight — model constants & presets (Tehran v1)
//  Every number here is an assumption that can be tuned.
//  See README → «روش محاسبه» for the reasoning behind each value.
// ─────────────────────────────────────────────────────────────

export const TEHRAN = {
  center: [35.7219, 51.3890],
  zoom: 12,
  // soft bounds used for search bias & map limits
  bounds: [[35.50, 51.05], [35.90, 51.75]],
};

// Road classes (OSM `highway` tag) → Persian label + defaults.
// laneDaily  = vehicles per lane per day (one direction) in typical Tehran conditions
// lanes      = default lanes per direction when OSM has no `lanes` tag
// freeFlow   = typical free-flow speed (km/h) when OSM has no `maxspeed`
export const ROAD_CLASSES = {
  motorway:       { fa: 'بزرگراه / آزادراه', short: 'بزرگراه', laneDaily: 21000, lanes: 4, freeFlow: 85, rank: 6 },
  trunk:          { fa: 'بزرگراه شهری',      short: 'بزرگراه شهری', laneDaily: 17000, lanes: 3, freeFlow: 70, rank: 5 },
  primary:        { fa: 'خیابان شریانی اصلی', short: 'شریانی اصلی', laneDaily: 11000, lanes: 3, freeFlow: 50, rank: 4 },
  secondary:      { fa: 'خیابان شریانی فرعی', short: 'شریانی فرعی', laneDaily: 7500,  lanes: 2, freeFlow: 45, rank: 3 },
  tertiary:       { fa: 'خیابان محلی اصلی',   short: 'محلی اصلی', laneDaily: 4500,  lanes: 1, freeFlow: 40, rank: 2 },
  motorway_link:  { fa: 'رمپ بزرگراه',        short: 'رمپ', laneDaily: 9000,  lanes: 1, freeFlow: 50, rank: 1 },
  trunk_link:     { fa: 'رمپ بزرگراه شهری',   short: 'رمپ', laneDaily: 8000,  lanes: 1, freeFlow: 45, rank: 1 },
  primary_link:   { fa: 'رابط شریانی',        short: 'رابط', laneDaily: 6000,  lanes: 1, freeFlow: 40, rank: 1 },
};
export const ROAD_QUERY = Object.keys(ROAD_CLASSES).join('|');

// Ad formats. Board size drives legibility; mount + setback drive the viewing geometry.
// w, h      = default face size in metres
// mount     = 'overhead' (over the carriageway, e.g. bridge deck) | 'side' (beside the road)
// setback   = metres from the road edge to the face (side mounts)
// notice    = share of passers-by who notice the face given ample time (placement/angle/size)
export const FORMATS = {
  bridge:    { fa: 'عرشه پل عابر پیاده', hint: 'روبه‌روی ترافیک، بالای سر', w: 24, h: 3.5, mount: 'overhead', setback: 0, notice: 0.50 },
  bulletin:  { fa: 'بیلبورد بزرگراهی (12×4 و بزرگ‌تر)', hint: 'کنار جاده، زاویه‌دار', w: 12, h: 4, mount: 'side', setback: 8, notice: 0.40 },
  poster:    { fa: 'استرابورد / تابلو متوسط (6×3)', hint: 'کنار جاده', w: 6, h: 3, mount: 'side', setback: 4, notice: 0.30 },
  digital:   { fa: 'تلویزیون شهری / تابلو دیجیتال', hint: 'نوری و متحرک — توجه بیشتر', w: 8, h: 4, mount: 'side', setback: 6, notice: 0.48 },
  rooftop:   { fa: 'تابلو پشت‌بامی / نمای ساختمان', hint: 'بالاتر از خط دید', w: 15, h: 6, mount: 'side', setback: 30, notice: 0.32 },
};

// Viewing geometry
export const VIS = {
  legiblePerMetre: 60,     // each metre of face height ≈ 60 m of legible distance (headline ≈ 15% of height)
  minLegible: 80, maxLegible: 450,
  laneWidth: 3.5,          // m
  shoulder: { motorway: 3, trunk: 2.5, primary: 1, secondary: 0.5, tertiary: 0.5, motorway_link: 1.5, trunk_link: 1.5, primary_link: 0.5 },
  median: { motorway: 4, trunk: 3, primary: 2, secondary: 0, tertiary: 0 },
  coneDeg: 35,             // a driver keeps a side board in comfortable view up to 35° off the road axis
  overheadElev: 6,         // m above the road for bridge decks
  overheadCutDeg: 25,      // looking up more than 25° ends the view under a bridge
  sightMax: 650,           // m of straight approach checked for curves
  clutterRadius: 150,      // m — other boards within this radius split attention
  clutterPenalty: 0.07,    // attention lost per nearby board (max 30%)
};

// Weekly pattern (Iranian week). Factor applied to the daily (weekday) volume.
export const WEEK = [
  { key: 'sat', fa: 'شنبه',     f: 1.00 },
  { key: 'sun', fa: 'یکشنبه',   f: 1.00 },
  { key: 'mon', fa: 'دوشنبه',   f: 1.00 },
  { key: 'tue', fa: 'سه‌شنبه',  f: 1.00 },
  { key: 'wed', fa: 'چهارشنبه', f: 1.02 },
  { key: 'thu', fa: 'پنجشنبه',  f: 0.86 },
  { key: 'fri', fa: 'جمعه',     f: 0.62 },
];
export const WEEK_SUM = WEEK.reduce((s, d) => s + d.f, 0);

// Typical Tehran hourly share of daily traffic (weekday), un-normalised.
const RAW_PROFILE = [1.6, 1.0, 0.7, 0.5, 0.5, 0.9, 2.6, 5.2, 6.3, 5.8, 5.4, 5.3,
                     5.3, 5.3, 5.4, 5.6, 6.0, 6.4, 6.5, 6.3, 5.7, 4.8, 3.9, 2.7];
const rawSum = RAW_PROFILE.reduce((a, b) => a + b, 0);
export const HOURLY_SHARE = RAW_PROFILE.map(v => v / rawSum);

// Typical speed as a share of free-flow speed, per hour (weekday, major roads).
export const SPEED_RATIO = [1.00, 1.00, 1.00, 1.00, 1.00, 0.98, 0.80, 0.50, 0.42, 0.52, 0.62, 0.64,
                            0.63, 0.62, 0.60, 0.56, 0.48, 0.42, 0.40, 0.43, 0.52, 0.64, 0.80, 0.92];

// Attention curve: P(notice | exposure t seconds) = 1 - exp(-t / ATTENTION_TAU)
export const ATTENTION_TAU = 6;

export const DEFAULTS = {
  occupancy: 1.5,     // people per vehicle (cars, taxis, buses blended)
  campaignWeeks: 4,
  dayType: 'weekday', // weekday | thursday | friday
};

// Neshan congestion colour → speed ratio (used when the analytics API answers with colours)
export const NESHAN_COLOR_RATIO = {
  green: 0.95, '#00ff00': 0.95, yellow: 0.70, orange: 0.45, red: 0.25, darkred: 0.15, '#8b0000': 0.15,
};

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const BASEMAPS = {
  dark: {
    fa: 'تیره',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '© OpenStreetMap · © CARTO', sub: 'abcd',
  },
  streets: {
    fa: 'خیابان‌ها',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '© OpenStreetMap · © CARTO', sub: 'abcd',
  },
  satellite: {
    fa: 'ماهواره',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, Maxar, Earthstar', sub: '',
  },
};

export const SITE_COLORS = ['#5B8CFF', '#FF7A59', '#2BD9A6', '#F5C451', '#C77DFF', '#FF5C8A', '#4DD0E1', '#A3E635'];

// Example sites for «با نقاط نمونه شروع کنید» (and the demo). Prices are illustrative, not quotes.
export const SAMPLES = [
  { name: 'همت — پل عابر نزدیک برج میلاد', lat: 35.7446, lng: 51.3720, format: 'bridge', facing: 'fwd', price: 450e6 },
  { name: 'مدرس — بیلبورد شمال ونک', lat: 35.7552, lng: 51.4327, format: 'bulletin', facing: 'fwd', price: 380e6 },
  { name: 'چمران — پل عابر دو رو', lat: 35.7670, lng: 51.3934, format: 'bridge', facing: 'both', price: 620e6 },
  { name: 'ولیعصر — تلویزیون شهری ونک', lat: 35.7520, lng: 51.4097, format: 'digital', facing: 'both', price: 160e6, loopShare: 0.25 },
  { name: 'رسالت — استرابورد', lat: 35.7366, lng: 51.4650, format: 'poster', facing: 'fwd', price: 140e6 },
];

// Public catalogue sample (Moarefan blog, Oct 2026): names and directions only, no coordinates.
// Import geocodes them; demo positions are approximate and only for the offline demo.
export const CATALOG_SAMPLE = [
  { name: 'ولنجک، نبش خیابان یمن', type: 'bulletin', owner: 'معرفان', demo: [35.7955, 51.3988] },
  { name: 'بزرگراه چمران، عرشه پل نمایشگاه (شرق به غرب)', type: 'bridge', owner: 'معرفان', demo: [35.7890, 51.3970] },
  { name: 'بزرگراه چمران، عرشه پل نمایشگاه (غرب به شرق)', type: 'bridge', owner: 'معرفان', demo: [35.7893, 51.3972] },
  { name: 'بزرگراه همت غرب به شرق، روبروی سازمان انتقال خون', type: 'bulletin', owner: 'معرفان', demo: [35.7493, 51.4160] },
  { name: 'بزرگراه شیخ فضل‌الله، پل کابلی میلاد (شمال به جنوب)', type: 'bridge', owner: 'معرفان', demo: [35.7420, 51.3772] },
  { name: 'بزرگراه شیخ فضل‌الله، پل کابلی میلاد (جنوب به شمال)', type: 'bridge', owner: 'معرفان', demo: [35.7417, 51.3769] },
  { name: 'بزرگراه همت، قبل از خروجی پاسداران، نزدیک پل صیاد', type: 'bulletin', owner: 'معرفان', demo: [35.7546, 51.4676] },
  { name: 'بزرگراه همت، تقاطع توانیر', type: 'bulletin', owner: 'معرفان', demo: [35.7497, 51.4250] },
  { name: 'بزرگراه همت، داخل لوپ خروجی چمران شمال', type: 'bulletin', owner: 'معرفان', demo: [35.7470, 51.3958] },
  { name: 'بزرگراه صدر، قبل از خروجی امام علی', type: 'bulletin', owner: 'معرفان', demo: [35.7885, 51.4680] },
  { name: 'بزرگراه مدرس، قبل از خروجی رسالت', type: 'bulletin', owner: 'معرفان', demo: [35.7380, 51.4328] },
  { name: 'بزرگراه چمران، خروجی نیایش غرب', type: 'bulletin', owner: 'معرفان', demo: [35.7735, 51.3931] },
  { name: 'بزرگراه نیایش، بین پل فرهنگ و سعادت‌آباد', type: 'bulletin', owner: 'معرفان', demo: [35.7725, 51.4050] },
  { name: 'بزرگراه نیایش، بعد از پل پاکنژاد', type: 'bulletin', owner: 'معرفان', demo: [35.7712, 51.4250] },
];
