"""Mark listings whose price was filled in by Rasamap's own formula (not read from the source page).

usage: python3 scripts/flag-estimated.py billboards.json traffic_formula_dir out.json
"""
import json, sys
sys.path.insert(0, sys.argv[2])
from traffic_formula import estimate_price  # MIT, Rasamap project

data = json.load(open(sys.argv[1], encoding='utf-8'))
n = 0
for x in data:
    try:
        est = estimate_price(x['city'], x['type'], x.get('width') or 6, x.get('height') or 4, x.get('location', ''), x.get('name', ''))
        x['priceEstimated'] = (est == x.get('price'))
        n += x['priceEstimated']
    except Exception:
        x['priceEstimated'] = False
json.dump(data, open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{n} estimated prices flagged of {len(data)}')
