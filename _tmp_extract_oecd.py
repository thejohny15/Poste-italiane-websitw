import requests
from pypdf import PdfReader

url = 'https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/04/taxing-wages-2025_20d1a01d/b3a95829-en.pdf'
content = requests.get(url, timeout=90).content
with open('/tmp/oecd_taxing_wages_2025.pdf', 'wb') as f:
    f.write(content)

reader = PdfReader('/tmp/oecd_taxing_wages_2025.pdf')
text = '\n'.join((p.extract_text() or '') for p in reader.pages)
with open('/tmp/oecd_taxing_wages_2025.txt', 'w') as f:
    f.write(text)

print('pages', len(reader.pages), 'text_len', len(text))
for country in ['Belgium', 'France', 'Germany', 'Italy', 'Poland', 'Spain']:
    print('country_count', country, text.lower().count(country.lower()))

lines = text.splitlines()
for country in ['Belgium', 'France', 'Germany', 'Italy', 'Poland', 'Spain']:
    print('\n###', country)
    count = 0
    for line in lines:
        l = line.lower()
        if country.lower() in l and ('%' in line or 'top' in l or 'pit' in l or 'rate' in l or 'statutory' in l):
            print(line[:240])
            count += 1
            if count >= 20:
                break
