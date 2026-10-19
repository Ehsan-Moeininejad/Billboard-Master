// Neshan search terms for scripts/update-pois.mjs, and what each found place counts as in the hotspot builder
// (OpenStreetMap-style tags, so js/hotspots.js treats them like any mapped shop or restaurant).
export const TERMS = [
  { q: 'رستوران', tags: { amenity: 'restaurant' }, ok: /رستوران|کباب|چلو|سفره ?خانه|غذا|طباخی|دیزی|بریانی|ماهی|سنتی|restaurant/i, types: ['restaurant'] },
  { q: 'کافه', tags: { amenity: 'cafe' }, ok: /کافه|قهوه|کافی ?شاپ|cafe|coffee/i, types: ['cafe'] },
  { q: 'فست فود', tags: { amenity: 'fast_food' }, ok: /فست ?فود|پیتزا|برگر|ساندویچ|سوخاری|اسنک|هات ?داگ|فلافل|fast ?food|pizza/i, types: ['fast_food'] },
  { q: 'پوشاک', tags: { shop: 'clothes' }, ok: /پوشاک|لباس|مانتو|بوتیک|مزون|شال|روسری|جین|تی ?شرت|کت و شلوار|پیراهن|پوشاک/, types: ['clothes', 'boutique'] },
  { q: 'مرکز خرید', tags: { shop: 'mall' }, ok: /مرکز خرید|مجتمع تجاری|پاساژ|(^|\s)مال(\s|$)|سنتر|بازار|mall|center/i, types: ['mall', 'department_store', 'marketplace'] },
  { q: 'کفش', tags: { shop: 'shoes' }, ok: /کفش|کتونی/, types: ['shoes'] },
  { q: 'موبایل', tags: { shop: 'mobile_phone' }, ok: /موبایل|گوشی|تلفن همراه|mobile/i, types: ['mobile_phone'] },
  { q: 'طلا فروشی', tags: { shop: 'jewelry' }, ok: /طلا|جواهر|زرگر/, types: ['jewelry'] },
  { q: 'آرایشی بهداشتی', tags: { shop: 'cosmetics' }, ok: /آرایش|بهداشتی|عطر|ادکلن/, types: ['cosmetics', 'perfumery'] },
  { q: 'شیرینی فروشی', tags: { shop: 'pastry' }, ok: /شیرینی|قنادی|نان ?فانتزی|کیک/, types: ['pastry', 'confectionery', 'bakery'] },
  { q: 'لوازم خانگی', tags: { shop: 'appliance' }, ok: /لوازم خانگی|لوازم برقی|الکتریک|صوتی|تصویری/, types: ['appliance', 'electronics'] },
  { q: 'هایپرمارکت', tags: { shop: 'supermarket' }, ok: /هایپر|فروشگاه زنجیره|افق|کوروش|رفاه|شهروند|جانبو|اتکا|سپه|یاس|hyper/i, types: ['supermarket'] },
  { q: 'بانک', tags: { amenity: 'bank' }, ok: /بانک|bank/i, types: ['bank'] },
  { q: 'درمانگاه', tags: { amenity: 'clinic' }, ok: /درمانگاه|کلینیک|پلی ?کلینیک|مطب|clinic/i, types: ['clinic', 'doctors', 'dentist'] },
  { q: 'بیمارستان', tags: { amenity: 'hospital' }, ok: /بیمارستان|hospital/i, types: ['hospital'] },
  { q: 'بستنی آبمیوه', tags: { amenity: 'ice_cream' }, ok: /بستنی|آبمیوه|اسموتی/, types: ['ice_cream'] },
  { q: 'سینما', tags: { amenity: 'cinema' }, ok: /سینما|پردیس سینمایی|cinema/i, types: ['cinema'] },
  { q: 'کتاب فروشی', tags: { shop: 'books' }, ok: /کتاب|نوشت ?افزار|لوازم ?التحریر/, types: ['books', 'stationery'] },
];
// stable id of a term in the saved file («amenity=restaurant»)
export const termId = T => Object.entries(T.tags).map(([k, v]) => `${k}=${v}`).join(';');
export const TAGS_BY_ID = Object.fromEntries(TERMS.map(T => [termId(T), T.tags]));
