// Store types offered in onboarding, with their default search fields and SAMPLE fitment rows.
// The first 6 automotive rows are real rows from the Bilstein NL CSV; the VW, Toyota and Volvo rows and all other rows are made up for the prototype.
/* ---------- store types (sample data) ----------
   A store picks ONE type during onboarding. The type only seeds fields, wording and sample rows. */
const TEMPLATES = {
  automotive: { label:'Automotive', icon:'car', tile:'t-indigo', noun:'vehicle', things:'parts', garage:'My Selection', heading:'Find parts for your vehicle',
    blurb:'Car, motorcycle or truck parts. Shoppers search by make, year and model.',
    fields:[['Make','list'],['Year','years'],['Model','list']],
    // Columns of the sample file: [column name, first values, what it was matched to].
    // Match: field index, 'from:i' / 'to:i' / 'range:i' for a year field, 'part' (SKU) or 'skip'.
    cols:[['Hersteller',['AUDI','BMW','FORD'],0],['BJVon',['2008','2016','2021'],'from:1'],['BJbis',['2011','','2025'],'to:1'],
      ['Modell',['A6 C6 Avant (4F5)','3 Gran Turismo (F34)','FOCUS IV (HN)'],2],['Artikelnummer',['47-116573','35-217480','19-295817'],'part'],
      ['Einbauposition',['Front axle','Rear axle','Front axle'],'skip']],
    rows:[
      ['AUDI','2008-2011','A6 C6 Avant (4F5)','47-116573',true],
      ['BMW','2016-','3 Gran Turismo (F34)','35-217480',true],
      ['FORD','2021-2025','FOCUS IV (HN)','19-295817',false],
      ['MERCEDES-BENZ','2015-2019','GLC (X253)','24-262965',true],
      ['SKODA','2017-2020','OCTAVIA III (5E3, NL3, NR3)','23-254343',true],
      ['LAND ROVER','2011-2017','DISCOVERY IV VAN (L319)','44-218676',true],
      ['VOLKSWAGEN','2015-2020','GOLF VII (5G1)','22-266767',true],
      ['TOYOTA','2018-','RAV4 V (A5)','24-294441',false],
      ['VOLVO','2016-','XC90 II (256)','22-274456',true]
    ]},
  phones: { label:'Phones and accessories', icon:'phone', tile:'t-pink', noun:'phone', things:'accessories', garage:'My Selection', heading:'Find accessories for your phone',
    blurb:'Brand, series and model. For cases, chargers and screen protectors.',
    fields:[['Brand','list'],['Series','list'],['Model','list']],
    cols:[['Brand',['Apple','Apple','Samsung'],0],['Series',['iPhone 15','iPhone 15','Galaxy S24'],1],['Model',['iPhone 15','iPhone 15 Pro','Galaxy S24 Ultra'],2],['SKU',['CASE-IP15','CASE-IP15P','CASE-S24U'],'part'],['Colour',['Black','Blue','Clear'],'skip']],
    rows:[
      ['Apple','iPhone 15','iPhone 15','CASE-IP15',true],
      ['Apple','iPhone 15','iPhone 15 Pro','CASE-IP15P',true],
      ['Apple','iPhone 15','iPhone 15 Pro Max','CASE-IP15PM',true],
      ['Samsung','Galaxy S24','Galaxy S24 Ultra','CASE-S24U',true],
      ['Samsung','Galaxy S24','Galaxy S24+','CASE-S24P',false],
      ['Google','Pixel 8','Pixel 8 Pro','CASE-PX8P',true]
    ]},
  beauty: { label:'Beauty and personal care', icon:'beauty', tile:'t-teal', noun:'profile', things:'products', garage:'My Selection', heading:'Find the right beauty product for you',
    blurb:'Skincare, haircare, makeup, fragrance and beauty devices. Shoppers filter by brand, product type and gender.',
    fields:[['Brand','list'],['Product type','list'],['Gender','list']],
    cols:[['Brand',['L’Oréal','Nivea','Maybelline'],0],['Product type',['Skincare','Haircare','Makeup'],1],['Gender',['Women','Men','Unisex'],2],['SKU',['BTY-LOR-SKIN-W','BTY-NIV-SKIN-M','BTY-MAY-MKP-W'],'part'],['Skin type',['Dry','Oily','All'],'skip']],
    rows:[
      ['L’Oréal','Skincare','Women','BTY-LOR-SKIN-W',true],
      ['L’Oréal','Haircare','Women','BTY-LOR-HAIR-W',true],
      ['L’Oréal','Skincare','Men','BTY-LOR-SKIN-M',true],
      ['Nivea','Skincare','Men','BTY-NIV-SKIN-M',true],
      ['Nivea','Skincare','Unisex','BTY-NIV-SKIN-U',false],
      ['Maybelline','Makeup','Women','BTY-MAY-MKP-W',true],
      ['Dyson','Beauty devices','Unisex','BTY-DYS-DEV-U',true]
    ]},
  custom: { label:'Something else', icon:'spark', tile:'t-amber', noun:'item', things:'products', garage:'My Selection', heading:'Find products that fit',
    blurb:'Printers, appliances, bicycles, tools or anything with a model. You name the fields.',
    fields:[['Brand','list'],['Model','list']], rows:[],
    cols:[['Brand',['HP','Canon','Epson'],0],['Model',['DeskJet 2720','PIXMA TS5150','EcoTank ET-2810'],1],['SKU',['INK-HP-2720','INK-CN-5150','INK-EP-2810'],'part']] }
};
function makeSetup(key) {
  const t = TEMPLATES[key];
  const fields = t.fields.map(([label, type]) => ({ id: nid('f'), label, type, required: true }));
  const rows = t.rows.map((r) => {
    const v = {}; fields.forEach((f, i) => { v[f.id] = r[i]; });
    return { id: nid('r'), v, part: r[fields.length], mapped: r[fields.length + 1] };
  });
  // Last imported files, newest first. The app keeps the last 5 so merchants can download a backup.
  const history = rows.length ? [
    { file: 'sample-data.csv', when: 'Today', mode: 'Add and update', rows: String(rows.length) },
    { file: 'sample-data-august.csv', when: '12 Sep 2026', mode: 'Add and update', rows: String(rows.length - 2) },
    { file: 'first-import.csv', when: '28 Aug 2026', mode: 'Replace all', rows: String(rows.length - 3) }
  ] : [];
  const use = (g) => typeof g === 'number' ? fields[g].id : /^(from|to|range):\d+$/.test(g) ? fields[+g.split(':')[1]].id + ':' + g.split(':')[0] : g;
  const cols = t.cols.map(([name, samples, g]) => ({ id: nid('c'), name, samples, use: use(g) }));
  // Store products with no filter rows yet (sample): shown on Product mapping.
  const loose = { automotive: [['Bilstein B4 shock absorber, front', '22-112233'], ['Wiper blade set 600/400 mm', 'WB-600400'], ['Brake cleaner 500 ml', 'CLN-500']],
    phones: [['USB-C charging cable 2 m', 'CBL-USBC-2'], ['Tempered glass, universal 6.1"', 'GLS-61']],
    beauty: [['Makeup brush set', 'BTY-BRUSH-SET'], ['Travel bottles 4-pack', 'BTY-TRAVEL-4']],
    custom: [['Cleaning kit', 'CLN-KIT']] }[key] || [];
  return { type: key, noun: t.noun, heading: t.heading, fields, rows, cols, history, looseProducts: loose.map(([title, sku]) => ({ title, sku })), universal: [] };
}
