"""Agency rate card (PDF table) → data/agency/*.json, for the cities other than Tehran.

    python3 scripts/agency-pdf.py --agency رسش --issued 1405/08/09 --issued-iso 2026-10-31 \
        --label "لیست پیشنهادی رسش شهرستان 4283" card1.pdf [card2.pdf …]

Reads tables whose header has «ردیف», «آدرس تابلو», «نوع تابلو», «متراژ», «ابعاد چاپ», «خالص پرداختی … (ریال)».
Rows of a city the site covers go to data/agency/<agency>-<slug>.json (placed on that city's map and used for its
price model); every row, including towns the site does not cover (Rasht, small towns of Mazandaran…), also goes to
data/agency/<agency>-regional.json, which only feeds the shared price model of the cities other than Tehran.
Tehran's own rate card (data/agency/rasesh.json) is not touched: Tehran prices stay on the Tehran card.
Needs: pip install pdfplumber
"""
import argparse, json, re, sys, os
import pdfplumber

CITY = {'تهران': None, 'کرج': 'karaj', 'اصفهان': 'isfahan', 'مشهد': 'mashhad', 'شیراز': 'shiraz', 'تبریز': 'tabriz',
        'کرمان': 'kerman', 'یزد': 'yazd', 'ساری': 'sari', 'گرگان': 'gorgan'}
DIRS = ['شرق به غرب', 'غرب به شرق', 'شمال به جنوب', 'جنوب به شمال']


def fix(s):
    """the PDF stores right-to-left text in visual order: reverse each line, then put numbers back"""
    if s is None:
        return ''
    out = []
    for line in s.split('\n'):
        r = line[::-1]
        r = re.sub(r'[\d.,/*]+', lambda m: m.group(0)[::-1], r)
        r = r.replace('(', '\0').replace(')', '(').replace('\0', ')')
        out.append(r.replace('‫', '').replace('‬', '').strip())
    return re.sub(r'\s+', ' ', ' '.join(x for x in out if x)).strip()


def col(hdr, *words):
    for i, h in enumerate(hdr):
        hh = h.replace(' ', '')
        if any(w in hh for w in words):
            return i
    return None


def kind(t):
    if 'پل' in t:
        return 'bridge', 'عرشه پل' if 'عرشه' in t else 'پل عابر'
    if 'لایت' in t or 'الیت' in t or 'باکس' in t:
        return 'poster', 'لایت‌باکس'
    if 'دیجیتال' in t or 'تلویزیون' in t or 'LED' in t.upper():
        return 'digital', 'تلویزیون شهری'
    if 'استرابورد' in t:
        return 'poster', 'استرابورد'
    return 'bulletin', 'بیلبورد عمودی' if 'عمودی' in t else 'بیلبورد'


def parse(pdf_path, card):
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for p in pdf.pages:
            for t in p.extract_tables():
                hdr = None
                for raw in t:
                    cells = [fix(c) for c in raw]
                    if any('ردیف' in c.replace(' ', '') or 'ابعاد' in c for c in cells) or col(cells, 'نوعتابلو') is not None:
                        hdr = cells
                        continue
                    if not hdr or not any(re.fullmatch(r'[\d,]{9,}', c.replace(' ', '')) for c in cells):
                        continue
                    get = lambda *w: (cells[col(hdr, *w)] if col(hdr, *w) is not None else '')
                    price_rial = int(re.sub(r'\D', '', get('خالص', 'ریال')) or 0)
                    addr = get('آدرس')
                    city = get('شهر')
                    town = get('محور')
                    code = get('کد')
                    code = ''.join(reversed(code.split())) if code and code != '-' else ''
                    size = re.findall(r'\d+(?:\.\d+)?', get('ابعاد'))
                    w = h = None
                    if len(size) >= 2:
                        a, b = float(size[0]) / 100, float(size[1]) / 100
                        w, h = max(a, b), min(a, b)
                    m2 = get('متر', 'متراژ', 'مترا')
                    m2 = float(re.sub(r'[^\d.]', '', m2) or 0) or (round(w * h, 1) if w and h else None)
                    when = get('تاریخ')
                    typ, typ_fa = kind(get('نوعتابلو', 'نوع'))
                    rows.append({
                        'card': card, 'row': get('ردیف'), 'cityFa': city, 'town': town if town not in ('', '-') else '',
                        'code': code, 'address': addr, 'type': typ, 'typeFa': typ_fa, 'w': w and round(w, 2), 'h': h and round(h, 2), 'm2': m2,
                        'price': round(price_rial / 10),  # rial → toman
                        'reservedUntil': when if re.match(r'\d{4}/\d\d/\d\d', when) else None,
                        'availableNow': 'قابل اکران' in when,
                        'dir': next((d for d in DIRS if d in addr), None),
                    })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdfs', nargs='+')
    ap.add_argument('--agency', required=True)
    ap.add_argument('--issued', required=True)
    ap.add_argument('--issued-iso', required=True)
    ap.add_argument('--label', default='')
    ap.add_argument('--out', default='data/agency')
    a = ap.parse_args()
    rows = []
    for f in a.pdfs:
        nums = re.findall(r'(?<![0-9a-f])(\d{4})(?![0-9a-f])', os.path.basename(f)) or re.findall(r'\d{4}', os.path.basename(f))
        rows += parse(f, nums[-1] if nums else os.path.basename(f))
    if not rows:
        sys.exit('no rows found')
    slug_of = lambda r: CITY.get(r['cityFa']) or ('sari' if 'ساری' in (r['town'] + r['address']) and r['cityFa'] == 'مازندران' else None)
    base = {'agency': a.agency, 'source': a.label or f'لیست پیشنهادی {a.agency} شهرستان‌ها', 'issued': a.issued, 'issuedIso': a.issued_iso, 'unit': 'تومان، 30 روزه'}
    by_city = {}
    for r in rows:
        s = slug_of(r)
        if s:
            by_city.setdefault(s, []).append(r)
    slug_fa = a.agency.replace(' ', '')
    for s, items in by_city.items():
        for i, r in enumerate(items):
            r['code'] = r['code'] or f"{r['card']}-{r['row'] or i + 1}"
        path = f'{a.out}/{"rasesh" if a.agency == "رسش" else slug_fa}-{s}.json'
        json.dump({**base, 'city': s, 'items': [{k: v for k, v in r.items() if k not in ('card', 'row', 'cityFa', 'town')} for r in items]},
                  open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'{path}: {len(items)}')
    # every row (with its town) for the shared price model of the cities other than Tehran
    reg = [{'label': r['town'] or r['cityFa'], 'cityFa': r['cityFa'], 'type': r['type'], 'm2': r['m2'], 'price': r['price']} for r in rows if r['price']]
    path = f'{a.out}/{"rasesh" if a.agency == "رسش" else slug_fa}-regional.json'
    json.dump({**base, 'city': 'regional', 'items': reg}, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(f'{path}: {len(reg)} rows for the price model')


if __name__ == '__main__':
    main()
