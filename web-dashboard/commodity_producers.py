"""Who actually produces each commodity — by country and by listed company.

Curated reference data, not a scrape. The authoritative sources here are the
USGS Mineral Commodity Summaries (metals), the EIA International Energy
Statistics (oil and gas), USDA FAS PSD (crops and meat) and the ICCO (cocoa).
Between them that is a PDF, a bulk CSV behind a form, an XLSX and a quarterly
bulletin — four fragile parsers producing numbers that change once a year. A
hand-checked table with the source and vintage printed next to it is more
honest and far less likely to break silently.

Every figure carries its year. When a figure goes stale the page says how old
it is rather than implying it is live.

Company lists distinguish what a company actually does:

    producer   digs it up, pumps it or grows it
    processor  refines, mills, smelts or slaughters — buys raw, sells finished
    royalty    owns a cut of someone else's production, no mines of its own
    buyer      an industrial consumer whose costs move with the price

That distinction matters: Hershey is not a cocoa producer, it is the reason
cocoa has a price. Lumping them together is how a "top cocoa producers" table
ends up listing a chocolate brand.
"""

# Front-month symbols and the funds tracking them share an underlying, so
# producer data is keyed by theme rather than by symbol.
THEME_ALIASES = {
    "Crude Oil (Brent)": "Crude Oil",
    "Crude Oil (WTI)":   "Crude Oil",
    "Gold miners":       "Gold",
    "Heating Oil":       "Refined Products",
    "RBOB Gasoline":     "Refined Products",
    "Energy equities":   "Energy",
    "Agriculture basket": "Agriculture",
    "Lean Hogs":         "Hogs",
    "Live Cattle":       "Cattle",
}

USGS = ("USGS Mineral Commodity Summaries 2024",
        "https://www.usgs.gov/centers/national-minerals-information-center")
EIA = ("EIA International Energy Statistics",
       "https://www.eia.gov/international/data/world")
USDA = ("USDA FAS Production, Supply and Distribution",
        "https://apps.fas.usda.gov/psdonline/app/index.html")
ICCO = ("ICCO Quarterly Bulletin of Cocoa Statistics",
        "https://www.icco.org/statistics/")

PRODUCERS = {
    # ── Metals ──────────────────────────────────────────────────────────────
    "Gold": {
        "year": 2023, "source": USGS, "unit": "tonnes", "world_total": 3000,
        "note": "Mine production only. Roughly a quarter of annual supply is "
                "recycled scrap, which does not appear here.",
        "countries": [("China", 370), ("Russia", 310), ("Australia", 310),
                      ("Canada", 200), ("United States", 170), ("Kazakhstan", 130),
                      ("Mexico", 130), ("Peru", 130), ("Uzbekistan", 110),
                      ("Ghana", 90)],
        "reserves_unit": "tonnes",
        "reserves": [("Australia", 12000), ("Russia", 11000), ("South Africa", 5000),
                     ("United States", 3000), ("China", 3000), ("Peru", 2700)],
        "companies": [
            ("NEM",  "Newmont",            "United States", "producer", "Largest gold miner by output"),
            ("GOLD", "Barrick Gold",       "Canada",        "producer", "Nevada Gold Mines JV with Newmont"),
            ("AEM",  "Agnico Eagle Mines", "Canada",        "producer", "Canada, Finland, Australia, Mexico"),
            ("AU",   "AngloGold Ashanti",  "South Africa",  "producer", "Africa, Americas, Australia"),
            ("GFI",  "Gold Fields",        "South Africa",  "producer", "South Deep plus Australia and Ghana"),
            ("KGC",  "Kinross Gold",       "Canada",        "producer", "Americas and West Africa"),
            ("SSRM", "SSR Mining",         "United States",  "producer", "Americas and Turkey"),
            ("FNV",  "Franco-Nevada",      "Canada",        "royalty",  "Royalties, owns no mines"),
            ("WPM",  "Wheaton Precious",   "Canada",        "royalty",  "Streaming contracts on others' output"),
            ("RGLD", "Royal Gold",         "United States", "royalty",  "Royalty and streaming portfolio"),
        ],
    },
    "Silver": {
        "year": 2023, "source": USGS, "unit": "tonnes", "world_total": 26000,
        "note": "Most silver is a by-product of copper, lead-zinc and gold mines "
                "rather than the main target, so supply responds weakly to the "
                "silver price alone.",
        "countries": [("Mexico", 6400), ("China", 3400), ("Peru", 3100),
                      ("Chile", 1400), ("Poland", 1300), ("Australia", 1200),
                      ("Bolivia", 1200), ("Russia", 1200), ("United States", 1000)],
        "reserves_unit": "tonnes",
        "reserves": [("Peru", 98000), ("Australia", 92000), ("Poland", 63000),
                     ("Russia", 92000), ("China", 72000), ("Mexico", 37000)],
        "companies": [
            ("PAAS", "Pan American Silver", "Canada",        "producer", "Latin America, largest listed pure-play"),
            ("FSM",  "Fortuna Mining",      "Canada",        "producer", "Latin America and West Africa"),
            ("HL",   "Hecla Mining",        "United States", "producer", "Largest US silver producer"),
            ("CDE",  "Coeur Mining",        "United States", "producer", "US, Mexico, Canada"),
            ("AG",   "First Majestic",      "Canada",        "producer", "Mexico-focused"),
            ("WPM",  "Wheaton Precious",    "Canada",        "royalty",  "Large silver streaming book"),
        ],
    },
    "Copper": {
        "year": 2023, "source": USGS, "unit": "thousand tonnes", "world_total": 22000,
        "note": "Chile and Peru together are roughly a third of world supply, so "
                "Andean strikes and water rules move the global price.",
        "countries": [("Chile", 5000), ("Peru", 2600), ("DR Congo", 2500),
                      ("China", 1700), ("United States", 1100), ("Russia", 910),
                      ("Indonesia", 840), ("Australia", 810), ("Zambia", 760),
                      ("Mexico", 750)],
        "reserves_unit": "thousand tonnes",
        "reserves": [("Chile", 190000), ("Australia", 100000), ("Peru", 120000),
                     ("DR Congo", 80000), ("Russia", 80000), ("Mexico", 53000)],
        "companies": [
            ("FCX",  "Freeport-McMoRan",  "United States", "producer", "Grasberg and the Americas"),
            ("SCCO", "Southern Copper",   "United States", "producer", "Peru and Mexico, Grupo Mexico unit"),
            ("BHP",  "BHP Group",         "Australia",     "producer", "Escondida, the largest copper mine"),
            ("RIO",  "Rio Tinto",         "Australia",     "producer", "Oyu Tolgoi and Kennecott"),
            ("TECK", "Teck Resources",    "Canada",        "producer", "Quebrada Blanca"),
            ("VALE", "Vale",              "Brazil",        "producer", "Copper alongside iron ore and nickel"),
            (None,   "Codelco",           "Chile",         "producer", "State-owned, world's largest — not listed"),
        ],
    },
    "Platinum": {
        "year": 2023, "source": USGS, "unit": "kilograms", "world_total": 180000,
        "note": "South Africa alone is about two thirds of supply, which makes the "
                "price unusually sensitive to its power grid and labour disputes.",
        "countries": [("South Africa", 120000), ("Russia", 23000), ("Zimbabwe", 19000),
                      ("Canada", 6400), ("United States", 3000)],
        "reserves_unit": "kilograms",
        "reserves": [("South Africa", 63000000), ("Russia", 5500000),
                     ("Zimbabwe", 1200000), ("United States", 900000)],
        "companies": [
            (None,   "Anglo American Platinum", "South Africa", "producer", "Largest producer, LSE/JSE listed"),
            (None,   "Impala Platinum",         "South Africa", "producer", "JSE listed"),
            (None,   "Sibanye-Stillwater",      "South Africa", "producer", "SA and Montana operations"),
            (None,   "Northam Platinum",        "South Africa", "producer", "JSE listed"),
        ],
    },
    "Palladium": {
        "year": 2023, "source": USGS, "unit": "kilograms", "world_total": 210000,
        "note": "Demand is dominated by petrol autocatalysts, so the long-term "
                "price question is how fast the vehicle fleet electrifies.",
        "countries": [("Russia", 92000), ("South Africa", 74000), ("Canada", 17000),
                      ("United States", 14000), ("Zimbabwe", 12000)],
        "reserves_unit": "kilograms",
        "reserves": [("South Africa", 63000000), ("Russia", 5500000)],
        "companies": [
            (None, "Norilsk Nickel",     "Russia",       "producer", "Largest producer, sanctioned/unlisted in US"),
            (None, "Sibanye-Stillwater", "South Africa", "producer", "Stillwater, Montana"),
            (None, "Impala Platinum",    "South Africa", "producer", "JSE listed"),
            (None, "Anglo American Platinum", "South Africa", "producer", "By-product of platinum mining"),
        ],
    },

    # ── Energy ──────────────────────────────────────────────────────────────
    "Crude Oil": {
        "year": 2023, "source": EIA, "unit": "million barrels per day", "world_total": 81.4,
        "note": "Brent prices North Sea crude and sets the seaborne benchmark; WTI "
                "prices lighter, sweeter crude delivered at Cushing, Oklahoma. Same "
                "producers, different delivery point — the spread between them is a "
                "transport and quality story, not a supply one.",
        "countries": [("United States", 12.9), ("Saudi Arabia", 11.4), ("Russia", 10.1),
                      ("Canada", 5.7), ("Iraq", 4.3), ("China", 4.2), ("Iran", 3.6),
                      ("UAE", 3.4), ("Brazil", 3.4), ("Kuwait", 2.9)],
        "reserves_unit": "billion barrels",
        "reserves": [("Venezuela", 303), ("Saudi Arabia", 267), ("Iran", 209),
                     ("Canada", 163), ("Iraq", 145), ("UAE", 111), ("Russia", 80)],
        "companies": [
            ("XOM",  "ExxonMobil",        "United States", "producer", "Permian and Guyana"),
            ("CVX",  "Chevron",           "United States", "producer", "Permian, Kazakhstan, Australia"),
            ("COP",  "ConocoPhillips",    "United States", "producer", "Largest US independent"),
            ("OXY",  "Occidental",        "United States", "producer", "Permian-weighted"),
            ("EOG",  "EOG Resources",     "United States", "producer", "Shale independent"),
            ("FANG", "Diamondback Energy", "United States", "producer", "Permian pure-play"),
            ("DVN",  "Devon Energy",      "United States", "producer", "Multi-basin shale"),
            ("APA",  "APA Corp",          "United States", "producer", "US, Egypt, North Sea"),
            ("SHEL", "Shell",             "Netherlands/UK", "producer", "Integrated major"),
            ("BP",   "BP",                "United Kingdom", "producer", "Integrated major"),
            ("TTE",  "TotalEnergies",     "France",        "producer", "Integrated major"),
            ("E",    "Eni",               "Italy",         "producer", "Integrated major"),
            ("CNQ",  "Canadian Natural",  "Canada",        "producer", "Oil sands"),
            ("SU",   "Suncor Energy",     "Canada",        "producer", "Oil sands, integrated"),
            ("IMO",  "Imperial Oil",      "Canada",        "producer", "Oil sands, Exxon affiliate"),
            (None,   "Saudi Aramco",      "Saudi Arabia",  "producer", "Largest producer, Tadawul listed"),
        ],
    },
    "Natural Gas": {
        "year": 2023, "source": EIA, "unit": "billion cubic metres", "world_total": 4100,
        "note": "Gas prices are regional, not global: pipelines cannot cross oceans, "
                "so Henry Hub, TTF and JKM can diverge sharply. LNG is what links them, "
                "and it is capacity-constrained.",
        "countries": [("United States", 1035), ("Russia", 586), ("Iran", 252),
                      ("China", 234), ("Canada", 190), ("Qatar", 181),
                      ("Australia", 152), ("Norway", 117), ("Saudi Arabia", 114),
                      ("Algeria", 101)],
        "reserves_unit": "trillion cubic metres",
        "reserves": [("Russia", 47.8), ("Iran", 34.0), ("Qatar", 23.9),
                     ("Turkmenistan", 13.6), ("United States", 12.9)],
        "companies": [
            ("EQT",  "EQT Corporation",  "United States", "producer", "Largest US gas producer, Appalachia"),
            ("EXE",  "Expand Energy",    "United States", "producer", "Chesapeake and Southwestern merged"),
            ("RRC",  "Range Resources",  "United States", "producer", "Marcellus"),
            ("COP",  "ConocoPhillips",   "United States", "producer", "Gas alongside oil, plus LNG"),
            ("XOM",  "ExxonMobil",       "United States", "producer", "Integrated, large gas book"),
            (None,   "Gazprom",          "Russia",        "producer", "State-controlled, not US listed"),
            (None,   "QatarEnergy",      "Qatar",         "producer", "Largest LNG exporter, state-owned"),
        ],
    },
    "Refined Products": {
        "year": 2023, "source": EIA, "unit": "million barrels per day refining capacity",
        "world_total": 102.0,
        "note": "Heating oil and RBOB gasoline are refined products, not raw "
                "commodities: nobody mines them. Their price is crude plus the crack "
                "spread — what a refiner earns for the conversion — so refining "
                "capacity, not oilfields, is the supply constraint.",
        "countries": [("United States", 18.1), ("China", 18.0), ("Russia", 6.9),
                      ("India", 5.2), ("South Korea", 3.6), ("Saudi Arabia", 3.4),
                      ("Japan", 3.2), ("Brazil", 2.3)],
        "companies": [
            ("MPC", "Marathon Petroleum", "United States", "processor", "Largest US refiner by capacity"),
            ("VLO", "Valero Energy",      "United States", "processor", "US Gulf Coast and Europe"),
            ("PSX", "Phillips 66",        "United States", "processor", "Refining and midstream"),
            ("XOM", "ExxonMobil",         "United States", "processor", "Integrated refining"),
            ("CVX", "Chevron",            "United States", "processor", "Integrated refining"),
            ("SHEL", "Shell",             "Netherlands/UK", "processor", "Integrated refining"),
            (None,  "Reliance Industries", "India",        "processor", "Jamnagar, largest single refinery"),
        ],
    },
    "Energy": {
        "year": 2023, "source": EIA, "unit": "million barrels per day", "world_total": 81.4,
        "note": "XLE is an equity fund, not a commodity holding. It owns the "
                "companies below, so it tracks their profits and dividends rather "
                "than the barrel price — the two diverge whenever margins move "
                "independently of crude.",
        "countries": [("United States", 12.9), ("Saudi Arabia", 11.4), ("Russia", 10.1),
                      ("Canada", 5.7), ("Iraq", 4.3), ("China", 4.2)],
        "companies": [
            ("XOM", "ExxonMobil",         "United States", "producer",  "Largest XLE weight"),
            ("CVX", "Chevron",            "United States", "producer",  "Second largest weight"),
            ("COP", "ConocoPhillips",     "United States", "producer",  "Largest pure E&P holding"),
            ("EOG", "EOG Resources",      "United States", "producer",  "Shale independent"),
            ("MPC", "Marathon Petroleum", "United States", "processor", "Refining weight"),
            ("PSX", "Phillips 66",        "United States", "processor", "Refining weight"),
            ("SLB", "SLB",                "United States", "processor", "Oilfield services"),
        ],
    },

    # ── Agriculture ─────────────────────────────────────────────────────────
    "Corn": {
        "year": "2023/24", "source": USDA, "unit": "million tonnes", "world_total": 1230,
        "note": "About a third of the US crop goes to ethanol and most of the rest to "
                "animal feed. Very little is eaten directly, so corn tracks fuel policy "
                "and livestock margins more than grocery demand.",
        "countries": [("United States", 390), ("China", 289), ("Brazil", 122),
                      ("European Union", 62), ("Argentina", 50), ("India", 36),
                      ("Ukraine", 32), ("Mexico", 27)],
        "companies": [
            ("ADM",  "Archer-Daniels-Midland", "United States", "processor", "Origination, milling, ethanol"),
            ("BG",   "Bunge Global",           "United States", "processor", "Grain trading and processing"),
            ("CTVA", "Corteva",                "United States", "buyer",     "Seed and crop protection input"),
            ("DE",   "Deere & Co",             "United States", "buyer",     "Equipment, revenue tracks farm income"),
            ("MOS",  "Mosaic",                 "United States", "buyer",     "Phosphate and potash fertiliser"),
            ("NTR",  "Nutrien",                "Canada",        "buyer",     "Fertiliser and farm retail"),
            ("CF",   "CF Industries",          "United States", "buyer",     "Nitrogen fertiliser"),
            (None,   "Cargill",                "United States", "processor", "Largest grain trader, private"),
            (None,   "Louis Dreyfus",          "Netherlands",   "processor", "Major grain trader, private"),
        ],
    },
    "Wheat": {
        "year": "2023/24", "source": USDA, "unit": "million tonnes", "world_total": 790,
        "note": "Russia and Ukraine together are close to a third of world exports, "
                "which is why the wheat price is a geopolitical instrument as much "
                "as an agricultural one.",
        "countries": [("China", 137), ("European Union", 134), ("India", 111),
                      ("Russia", 92), ("United States", 49), ("Canada", 32),
                      ("Australia", 26), ("Ukraine", 23), ("Argentina", 15)],
        "companies": [
            ("ADM", "Archer-Daniels-Midland", "United States", "processor", "Milling and origination"),
            ("BG",  "Bunge Global",           "United States", "processor", "Grain trading"),
            ("NTR", "Nutrien",                "Canada",        "buyer",     "Fertiliser input"),
            ("DE",  "Deere & Co",             "United States", "buyer",     "Equipment"),
            (None,  "Cargill",                "United States", "processor", "Private"),
            (None,  "Viterra",                "Switzerland",   "processor", "Private, merging with Bunge"),
        ],
    },
    "Soybeans": {
        "year": "2023/24", "source": USDA, "unit": "million tonnes", "world_total": 395,
        "note": "Brazil overtook the US as the largest producer and exporter. Chinese "
                "crush demand is the single biggest swing factor in the price.",
        "countries": [("Brazil", 153), ("United States", 113), ("Argentina", 48),
                      ("China", 20), ("India", 12), ("Paraguay", 10)],
        "companies": [
            ("BG",   "Bunge Global",           "United States", "processor", "Largest oilseed crusher"),
            ("ADM",  "Archer-Daniels-Midland", "United States", "processor", "Crushing and refining"),
            ("AGRO", "Adecoagro",              "Luxembourg",    "producer",  "South American farmland"),
            ("CTVA", "Corteva",                "United States", "buyer",     "Seed traits"),
            (None,   "Cargill",                "United States", "processor", "Private"),
            (None,   "COFCO",                  "China",         "processor", "State-owned buyer"),
        ],
    },
    "Cotton": {
        "year": "2023/24", "source": USDA, "unit": "million 480 lb bales", "world_total": 113,
        "note": "Cotton competes with polyester, so the oil price sets a soft ceiling "
                "on it. Demand follows apparel retail rather than food.",
        "countries": [("China", 27), ("India", 25), ("Brazil", 15),
                      ("United States", 12), ("Pakistan", 5), ("Australia", 4.5),
                      ("Turkey", 3)],
        "companies": [
            (None, "Louis Dreyfus", "Netherlands",   "processor", "Major cotton merchant, private"),
            (None, "Olam Agri",     "Singapore",     "processor", "Cotton merchandising"),
            (None, "Cargill",       "United States", "processor", "Private"),
        ],
    },
    "Sugar": {
        "year": "2023/24", "source": USDA, "unit": "million tonnes raw value", "world_total": 180,
        "note": "Brazilian mills switch between sugar and ethanol depending on which "
                "pays better, so the sugar price is partly a function of the oil price.",
        "countries": [("Brazil", 46), ("India", 34), ("European Union", 15),
                      ("China", 10), ("Thailand", 9), ("United States", 8)],
        "companies": [
            ("CSAN", "Cosan",       "Brazil",        "producer",  "Raízen JV, largest sugar-ethanol group"),
            ("AGRO", "Adecoagro",   "Luxembourg",    "producer",  "Argentine and Brazilian mills"),
            ("ADM",  "Archer-Daniels-Midland", "United States", "processor", "Sweeteners"),
            ("KDP",  "Keurig Dr Pepper", "United States", "buyer", "Beverage sweetener cost"),
            (None,   "Wilmar International", "Singapore", "processor", "Refining and merchandising"),
        ],
    },
    "Coffee": {
        "year": "2023/24", "source": USDA, "unit": "million 60 kg bags", "world_total": 172,
        "note": "Brazil grows arabica, Vietnam grows robusta, and the two trade as "
                "separate contracts. Production is dominated by smallholders and "
                "co-operatives, so there is no listed pure-play grower to speak of.",
        "countries": [("Brazil", 66), ("Vietnam", 27), ("Colombia", 13),
                      ("Indonesia", 10), ("Ethiopia", 8), ("Honduras", 6),
                      ("India", 6), ("Uganda", 6)],
        "companies": [
            ("SBUX", "Starbucks",     "United States", "buyer",     "Largest branded buyer, hedges green coffee"),
            ("KDP",  "Keurig Dr Pepper", "United States", "buyer",  "K-Cup packaged coffee"),
            (None,   "Nestlé",        "Switzerland",   "buyer",     "Nescafé and Nespresso"),
            (None,   "JDE Peet's",    "Netherlands",   "processor", "Roasting, Euronext listed"),
            (None,   "Neumann Kaffee", "Germany",      "processor", "Largest green coffee trader, private"),
        ],
    },
    "Cocoa": {
        "year": "2023/24", "source": ICCO, "unit": "thousand tonnes", "world_total": 4300,
        "note": "West Africa is roughly 70% of world supply, and the 2023/24 harvest "
                "failed there on disease and weather — which is why cocoa broke every "
                "historical price record that season. Farmgate prices in Côte d'Ivoire "
                "and Ghana are set by government boards, so the futures price and what "
                "farmers actually receive move separately.",
        "countries": [("Côte d'Ivoire", 1750), ("Ghana", 650), ("Ecuador", 430),
                      ("Cameroon", 300), ("Nigeria", 280), ("Indonesia", 180),
                      ("Brazil", 200)],
        "companies": [
            ("HSY",  "Hershey",       "United States", "buyer",     "Cost base is cocoa"),
            ("MDLZ", "Mondelez",      "United States", "buyer",     "Cadbury, Milka"),
            (None,   "Barry Callebaut", "Switzerland", "processor", "Largest cocoa processor, SIX listed"),
            (None,   "Olam Food Ingredients", "Singapore", "processor", "Cocoa origination and grinding"),
            (None,   "Cargill",       "United States", "processor", "Cocoa grinding, private"),
        ],
    },
    "Agriculture": {
        "year": "2023/24", "source": USDA, "unit": "million tonnes", "world_total": None,
        "note": "DBA is a basket, not a single crop — it spreads across corn, wheat, "
                "soybeans, sugar, coffee, cocoa and livestock. The countries below are "
                "the largest agricultural producers overall; the individual crop pages "
                "carry the specific numbers.",
        "countries": [("China", None), ("United States", None), ("India", None),
                      ("Brazil", None), ("European Union", None), ("Russia", None),
                      ("Argentina", None)],
        "companies": [
            ("ADM",  "Archer-Daniels-Midland", "United States", "processor", "Origination and processing"),
            ("BG",   "Bunge Global",           "United States", "processor", "Oilseeds and grain"),
            ("CTVA", "Corteva",                "United States", "buyer",     "Seed and crop protection"),
            ("MOS",  "Mosaic",                 "United States", "buyer",     "Phosphate and potash"),
            ("NTR",  "Nutrien",                "Canada",        "buyer",     "Fertiliser"),
            ("CF",   "CF Industries",          "United States", "buyer",     "Nitrogen"),
            ("DE",   "Deere & Co",             "United States", "buyer",     "Equipment"),
            ("FMC",  "FMC Corporation",        "United States", "buyer",     "Crop chemicals"),
            ("AGCO", "AGCO",                   "United States", "buyer",     "Equipment"),
        ],
    },

    # ── Livestock ───────────────────────────────────────────────────────────
    "Cattle": {
        "year": 2024, "source": USDA, "unit": "million tonnes carcass weight",
        "world_total": 60,
        "note": "The US herd is at multi-decade lows after years of drought. Rebuilding "
                "means holding heifers back from slaughter, which tightens near-term "
                "supply further — the price signal and the supply response point the "
                "same way for a while.",
        "countries": [("United States", 12.3), ("Brazil", 11.8), ("China", 7.8),
                      ("European Union", 6.8), ("India", 4.4), ("Argentina", 3.1),
                      ("Australia", 2.5)],
        "companies": [
            ("TSN", "Tyson Foods",  "United States", "processor", "Largest US beef packer"),
            ("HRL", "Hormel Foods", "United States", "processor", "Branded protein"),
            (None,  "JBS",          "Brazil",        "processor", "Largest meat processor worldwide"),
            (None,  "Cargill",      "United States", "processor", "Beef packing, private"),
            (None,  "Marfrig",      "Brazil",        "processor", "B3 listed"),
        ],
    },
    "Hogs": {
        "year": 2024, "source": USDA, "unit": "million tonnes carcass weight",
        "world_total": 116,
        "note": "China is roughly half of world pork production and consumption, so its "
                "herd cycle and any African swine fever outbreak dominate the global "
                "price far more than US supply does.",
        "countries": [("China", 57), ("European Union", 21), ("United States", 12.7),
                      ("Brazil", 4.5), ("Russia", 4.6), ("Vietnam", 3.8)],
        "companies": [
            ("TSN", "Tyson Foods",  "United States", "processor", "Pork packing"),
            ("HRL", "Hormel Foods", "United States", "processor", "Branded pork"),
            ("SFD", "Smithfield Foods", "United States", "processor", "Largest US hog producer, WH Group unit"),
            ("PPC", "Pilgrim's Pride", "United States", "processor", "Protein, JBS majority owned"),
            (None,  "WH Group",     "China",         "processor", "Owns Smithfield, HKEX listed"),
        ],
    },

    # ── Baskets ─────────────────────────────────────────────────────────────
    "Broad basket": {
        "year": 2023, "source": None, "unit": None, "world_total": None,
        "note": "A diversified index fund rather than one commodity. Typical weights "
                "run roughly 40-55% energy, 20-30% agriculture, 15-25% metals, with "
                "the exact split set by the index the fund follows. There is no single "
                "producer set — see the individual commodity pages. Note that these "
                "funds hold futures and must roll them, so in contango the roll bleeds "
                "return even when spot prices are flat.",
        "countries": [], "companies": [],
    },
}


def theme_for(name, tracks=None):
    """Resolve a commodity's name or tracked underlying to a producer theme."""
    raw = (tracks or name or "").strip()
    return THEME_ALIASES.get(raw, raw)


def producers_for(name, tracks=None):
    """Producer data for a commodity, or None when the theme has no entry."""
    theme = theme_for(name, tracks)
    data = PRODUCERS.get(theme)
    if not data:
        return None
    src = data.get("source")
    countries = data.get("countries") or []
    total = data.get("world_total")
    return {
        "theme": theme,
        "year": data.get("year"),
        "unit": data.get("unit"),
        "world_total": total,
        "note": data.get("note"),
        "source_name": src[0] if src else None,
        "source_url": src[1] if src else None,
        "countries": [{
            "country": c, "production": v,
            "share_pct": round(v / total * 100, 1) if (v and total) else None,
        } for c, v in countries],
        "reserves_unit": data.get("reserves_unit"),
        "reserves": [{"country": c, "reserves": v}
                     for c, v in (data.get("reserves") or [])],
        "companies": [{
            "ticker": t, "name": n, "country": c, "role": r, "note": note,
        } for t, n, c, r, note in (data.get("companies") or [])],
    }
