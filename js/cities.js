// Cities the site covers. Shared by the browser (js/city.js) and the data scripts (scripts/*.mjs).
// Tehran keeps exactly the values it always had; its data stays in data/ and its browser storage keys are unchanged.
// Every other city lives in data/cities/<slug>/ and stores its own inventory, prices and saved points.
//
//   center/zoom/bounds  map start and soft limits (bounds also bias the search)
//   box                 [s, w, n, e] area for roads, districts, hotspots and accepting billboard listings
//   sources             value(s) of the «city» field in the Rasamap listings
//   volF                traffic volume relative to Tehran on the same kind of road (first estimate, see README)
//   districts           whether OSM has numbered municipal districts for the city
//   limited             little billboard data (shown as «داده محدود»)
export const CITIES = {
  tehran: { fa: 'تهران', center: [35.7219, 51.3890], zoom: 12, bounds: [[35.50, 51.05], [35.90, 51.75]], box: [35.55, 51.10, 35.85, 51.65], sources: ['تهران'], volF: 1, districts: true, minDistricts: 15 },
  karaj: { fa: 'کرج', center: [35.8225, 50.9905], zoom: 13, bounds: [[35.70, 50.75], [35.95, 51.15]], box: [35.74, 50.82, 35.90, 51.08], sources: ['کرج'], volF: 0.75, districts: true, minDistricts: 6 },
  isfahan: { fa: 'اصفهان', center: [32.6560, 51.6680], zoom: 12, bounds: [[32.45, 51.45], [32.88, 51.95]], box: [32.53, 51.55, 32.80, 51.85], sources: ['اصفهان'], volF: 0.75, districts: true, minDistricts: 8 },
  mashhad: { fa: 'مشهد', center: [36.2975, 59.6059], zoom: 12, bounds: [[36.10, 59.35], [36.50, 59.85]], box: [36.17, 59.42, 36.43, 59.78], sources: ['مشهد'], volF: 0.8, districts: true, minDistricts: 8 },
  shiraz: { fa: 'شیراز', center: [29.6100, 52.5300], zoom: 12, bounds: [[29.45, 52.32], [29.80, 52.75]], box: [29.52, 52.40, 29.73, 52.66], sources: ['شیراز'], volF: 0.7, districts: true, minDistricts: 6 },
  kerman: { fa: 'کرمان', center: [30.2852, 57.0648], zoom: 13, bounds: [[30.15, 56.90], [30.42, 57.23]], box: [30.20, 56.95, 30.36, 57.17], sources: ['کرمان'], volF: 0.55, districts: true, minDistricts: 3, limited: true },
  yazd: { fa: 'یزد', center: [31.8974, 54.3600], zoom: 13, bounds: [[31.76, 54.18], [32.03, 54.54]], box: [31.82, 54.25, 31.98, 54.47], sources: ['یزد'], volF: 0.55, districts: false },
  sari: { fa: 'ساری', center: [36.5600, 53.0600], zoom: 13, bounds: [[36.45, 52.92], [36.66, 53.20]], box: [36.50, 52.98, 36.61, 53.14], sources: ['ساری'], volF: 0.5, districts: true, minDistricts: 2, limited: true },
  gorgan: { fa: 'گرگان', center: [36.8400, 54.4394], zoom: 13, bounds: [[36.74, 54.28], [36.93, 54.59]], box: [36.79, 54.35, 36.88, 54.52], sources: ['گرگان'], volF: 0.5, districts: false, limited: true },
};
export const CITY_SLUGS = Object.keys(CITIES);
export const OTHER_CITIES = CITY_SLUGS.filter(s => s !== 'tehran');

// where a city's data lives (Tehran keeps the original paths)
export const cityDir = slug => (slug === 'tehran' ? 'data' : `data/cities/${slug}`);

// place names that mark a listing as belonging somewhere else (used when accepting a city's listings)
export const ELSEWHERE = ['چالوس', 'مرزن', 'تونل', 'سنگان', 'کرج', 'شهریار', 'اسلامشهر', 'لواسان', 'دماوند', 'رودهن', 'فشم', 'پرند', 'قزوین',
  'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'قم', 'کیش', 'رشت', 'ساری', 'گرگان', 'یزد', 'کرمان', 'کاشان', 'نجف‌آباد', 'نجف آباد', 'خمینی‌شهر', 'خمینی شهر',
  'شاهین‌شهر', 'شاهین شهر', 'رفسنجان', 'ماهان', 'سیرجان', 'بم', 'نوشهر', 'نور', 'بابل', 'آمل', 'قائم‌شهر', 'قائمشهر', 'گنبد', 'علی‌آباد', 'نیشابور',
  'طرقبه', 'شاندیز', 'تربت', 'مرودشت', 'صدرا', 'میبد', 'اردکان', 'هشتگرد', 'نظرآباد', 'ساوجبلاغ', 'فردیس', 'ماهدشت', 'محمدشهر', 'تهران', 'تبریز', 'اهواز', 'بندرعباس'];
