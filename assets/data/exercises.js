// Quiz items generated from the workbook's own Practice & Review section (Unit 11, pages 35-36).
// Each exercise is shaped to one of the existing component types in App.js:
//   mcq            — single choice with 4 options
//   match          — 4 pairs to match
//   fillblank      — fill in the blank with one of 4 options
//   wordarrange    — arrange words into correct order
//   trope-identify — from TROPE_VERSES (positioned identification)

export const UNIT_EXERCISES = {
  // Unit 1 — What is a Siddur?
  "what-is-siddur": [
    {
      type: "mcq",
      question: "The word Siddur (סִדּוּר) comes from the Hebrew root meaning:",
      options: ["order / arrangement", "blessing", "singing", "rest"],
      correct: "order / arrangement",
      fact: "The root ס-ד-ר (s-d-r) is shared with 'Seder' (Passover ritual) and 'Shisha Sedarim' (Six Orders of the Mishnah).",
    },
    {
      type: "mcq",
      question: "Who compiled the first comprehensive written Siddur, and roughly when?",
      options: ["Rav Amram Gaon (c. 860 CE)", "Maimonides (12th c.)", "Rashi (11th c.)", "Saadia Gaon (10th c.)"],
      correct: "Rav Amram Gaon (c. 860 CE)",
      fact: "Rav Amram Gaon of Sura, Babylonia wrote the Seder Rav Amram in response to a query from the Jews of Barcelona — the ancestor of every Siddur used today.",
    },
    {
      type: "match",
      pairs: [
        { left: "Talmudic Era", right: "Three daily services crystallize (c. 100 BCE – 500 CE)" },
        { left: "Geonic Period", right: "First written Siddur (c. 860 CE)" },
        { left: "Rishonim", right: "Machzor Vitry codifies Ashkenazi rite (11th c.)" },
        { left: "Age of Print", right: "First printed Siddur in Soncino, 1486" },
      ],
    },
    {
      type: "wordarrange",
      english: "The Siddur is literally 'the ordered arrangement of Jewish prayer.'",
      words: ["סִדּוּר","תְּפִילָה","עִבְרִית","שֶׁל","עַם","הַסְּדָר"],
      correct_order: ["שֶׁל","עַם","הַסְּדָר","תְּפִילָה","סִדּוּר","עִבְרִית"],
      hint: "Of the people, the order, the prayer, the Siddur, Hebrew.",
    },
  ],

  // Unit 2 — Components of Prayer
  "prayer-components": [
    {
      type: "mcq",
      question: "ברכות השחר (Birkot HaShachar) are:",
      options: ["Morning blessings upon waking", "Blessings after the Shema", "Evening prayers", "Closing hymns"],
      correct: "Morning blessings upon waking",
      fact: "Birkot HaShachar are 15 blessings of gratitude recited after waking — for sight, clothing, steps, and Torah learning.",
    },
    {
      type: "mcq",
      question: "Pesukei D'Zimra (פסוקי דזמרא) consists mainly of:",
      options: ["Psalms 145–150 and selected biblical passages", "The Amidah's 19 blessings", "The Priestly Blessing", "Piyyutim from the Bukharian rite"],
      correct: "Psalms 145–150 and selected biblical passages",
      fact: "Pesukei D'Zimra — 'Verses of Song' — is bracketed by Baruch She'amar and Yishtabach.",
    },
    {
      type: "match",
      pairs: [
        { left: "Birkot HaShachar", right: "ברכות השחר — morning blessings" },
        { left: "Pesukei D'Zimra",  right: "פסוקי דזמרא — verses of song" },
        { left: "Kriat Shema",      right: "קריאת שמע — Shema and its blessings" },
        { left: "Amidah",           right: "עֲמִידָה — the Standing Prayer (19 blessings)" },
      ],
    },
  ],

  // Unit 3 — Ta'amei HaMikra (Trope)
  "taamei-hamikra": [
    {
      type: "mcq",
      question: "Which mark appears at the end of every single Bible verse?",
      options: ["Siluk / Sof Pasuk", "Etnachta", "Merkha", "Pashta"],
      correct: "Siluk / Sof Pasuk",
      fact: "Siluk (a vertical line under the accented word) and Etnachta (a small upward hook below) together form the 'skeleton' of biblical parsing — every verse has both.",
    },
    {
      type: "mcq",
      question: "How many times does Shalshelet appear in the Torah?",
      options: ["4 times — all moments of hesitation", "Once — at Numbers 35:5", "Never", "12 times"],
      correct: "4 times — all moments of hesitation",
      fact: "Shalshelet appears 4 times in Torah — Lot lingering (Gen 19:16), Eliezer praying (Gen 24:12), Joseph refusing (Gen 39:8), and Moses ordaining Aaron (Lev 8:23). Each marks inner struggle.",
    },
    {
      type: "match",
      pairs: [
        { left: "Siluk + Sof Pasuk", right: "Period — strongest pause, every verse" },
        { left: "Etnachta",          right: "Semicolon — splits the verse in two" },
        { left: "Zakef / Segol",     right: "Comma — common mid-pause" },
        { left: "Merkha / Munach",   right: "No pause — conjunctive, links words" },
      ],
    },
    {
      type: "mcq",
      question: "The acronym אמ״ת (which uses a different trope system) stands for:",
      options: ["Psalms, Job, Proverbs", "Abraham, Moses, Tisha", "Alef, Mem, Tav", "Ashrei, Modeh, Tefila"],
      correct: "Psalms, Job, Proverbs",
      fact: "אמ״ת = איוב (Job), משלי (Proverbs), תהלים (Psalms). These use 'Ta'amei Emet' (28 marks) instead of the 21-book system's marks.",
    },
    {
      type: "mcq",
      question: "Which conjunctive trope ALWAYS comes before Pashta?",
      options: ["Mahpakh", "Merkha", "Kadma", "Darga"],
      correct: "Mahpakh",
      fact: "Mahpakh (the triangular 'V' below) is a 'reversal' — ascending-descending motion — and always precedes Pashta.",
    },
  ],

  // Unit 6 — Shacharit
  "shacharit": [
    {
      type: "wordarrange",
      english: "Order of weekday Shacharit: Modeh Ani → Birkot HaShachar → Pesukei D'Zimra → Shema → Amidah.",
      words: ["Shema","Modeh","Amidah","Ani","Birkot","Pesukei","D'Zimra","HaShachar"],
      correct_order: ["Modeh","Ani","Birkot","HaShachar","Pesukei","D'Zimra","Shema","Amidah"],
      hint: "Modeh Ani → Birkot HaShachar → Pesukei D'Zimra → Shema → Amidah",
    },
    {
      type: "mcq",
      question: "Which prayer corresponds to Abraham, Isaac, and Jacob?",
      options: ["Shacharit, Mincha, Ma'ariv", "Shacharit, Musaf, Ne'ilah", "Pesukei, Shema, Amidah", "Birkat, Kedushah, Kaddish"],
      correct: "Shacharit, Mincha, Ma'ariv",
      fact: "Berakhot 26b traces the three daily prayers to the three patriarchs: Abraham (Shacharit), Isaac (Mincha), Jacob (Ma'ariv).",
    },
    {
      type: "mcq",
      question: "The Amidah is also known as:",
      options: ["Shemoneh Esrei (the Eighteen)", "Hallel", "Pesukei D'Zimra", "Birkat HaMazon"],
      correct: "Shemoneh Esrei (the Eighteen)",
      fact: "Although called 'Eighteen,' the weekday Amidah actually has 19 blessings — the birkat haMinim (against heretics) was added in the time of Rabban Gamliel.",
    },
  ],

  // Unit 11 — Tradition comparison
  "tradition-comparison": [
    {
      type: "match",
      pairs: [
        { left: "Ashkenazi",  right: "Yiddish home language; ShUM cities (Speyer, Worms, Mainz)" },
        { left: "Sephardic",  right: "Ladino (Judezmo); maqam-based modal system" },
        { left: "Bukharian",  right: "Judeo-Tajik; Shashmaqam — 6 modes for prayer" },
        { left: "Yemenite",   right: "Baladi rite; Ayin and Chet nearly silent" },
      ],
    },
    {
      type: "mcq",
      question: "The Shashmaqam — six maqamat paired with six prayer modes — comes from which tradition?",
      options: ["Bukharian", "Ashkenazi", "Sephardic", "Italian"],
      correct: "Bukharian",
      fact: "Bukharian Jews brought the Shashmaqam from Central Asia — six maqamat (modes) used to chant prayers, especially on Shabbat and holidays.",
    },
    {
      type: "mcq",
      question: "Selichot for Ashkenazim begin on the Motzei Shabbat before Rosh Hashanah; Sephardim begin on:",
      options: ["Rosh Chodesh Elul", "Rosh Hashanah itself", "Tisha B'Av", "Yom Kippur"],
      correct: "Rosh Chodesh Elul",
      fact: "Two parallel customs: Ashkenazi start a week before RH (Motzei Shabbat), Sephardim begin at the start of Elul — a full month earlier.",
    },
  ],

  // Unit 12/13 — Hebrew alphabet
  "hebrew-alphabet": [
    {
      type: "mcq",
      question: "Which letter is the first of the Hebrew alphabet?",
      options: ["א Alef", "ב Bet", "ג Gimel", "ה Hey"],
      correct: "א Alef",
      fact: "Alef is silent — it carries vowel sounds but is not pronounced on its own. It's the first of the 22 letters.",
    },
    {
      type: "match",
      pairs: [
        { left: "א Alef",  right: "Silent — carries vowels" },
        { left: "ב Bet",   right: "'b' (or 'v' without dagesh)" },
        { left: "ש Shin",  right: "'sh' — dot on right" },
        { left: "ת Tav",   right: "'t' — last letter (aleph-bet ends here)" },
      ],
    },
    {
      type: "mcq",
      question: "The four letters ב, ג, ד, כ, פ, ת (beged-kefet) take a 'dagesh' to become hard. In modern Israeli Hebrew, they typically soften to:",
      options: ["v, g, d, kh, f, t", "Always remain hard", "Disappear entirely", "Take a vowel instead"],
      correct: "v, g, d, kh, f, t",
      fact: "In Yemenite and some liturgical traditions, these letters stay hard (b, g, d, k, p, t). In modern Hebrew, they soften without dagesh.",
    },
    {
      type: "wordarrange",
      english: "First five letters of the alphabet in order.",
      words: ["Alef","Gimel","Hey","Bet","Dalet"],
      correct_order: ["Alef","Bet","Gimel","Dalet","Hey"],
      hint: "Alef, Bet, Gimel, Dalet, Hey",
    },
  ],

  // Unit 14/15 — Numbers & Gender
  "numbers-gender": [
    {
      type: "mcq",
      question: "The plural of סֵפֶר (sefer, book — masculine singular) is:",
      options: ["סְפָרִים (sfarim)", "סֵפֶרִים (sefarim)", "סִפְרוֹת (sifrot)", "סֵפֶרוֹת (seferot)"],
      correct: "סְפָרִים (sfarim)",
      fact: "Hebrew masculine plurals typically take the suffix ים־ (-im). Feminine plurals take ות־ (-ot). סֵפֶר → סְפָרִים.",
    },
    {
      type: "mcq",
      question: "Adjectives in Hebrew must agree with their noun in:",
      options: ["Gender and number", "Only gender", "Only number", "Verb tense"],
      correct: "Gender and number",
      fact: "Adjectives follow the noun and must match in gender and number: yeled gadol (big boy), yalda gdola (big girl), yeladim gdolim (big boys).",
    },
    {
      type: "fillblank",
      template: "הַיַּלְדָּה הַקְּטַנָּה ___ בַּגַּן. (The little girl ___ in the garden.)",
      correct_target: "מְשַׂחֶקֶת",
      options: ["מְשַׂחֶקֶת", "מְשַׂחֵק", "מְשַׂחֲקִים", "מְשַׂחֶקֶת"],
      fact: "Feminine singular present-tense participle: מְשַׂחֶקֶת (m'sa-khe-KET — 'is playing'). The masculine would be מְשַׂחֵק.",
    },
  ],

  // Unit 16 — Prefixes & Suffixes
  "prefixes-suffixes": [
    {
      type: "match",
      pairs: [
        { left: "בְּ (b'/be)",   right: "in, at" },
        { left: "לְ (l'/le)",    right: "to, for" },
        { left: "מִ (mi)",       right: "from" },
        { left: "עַל (al)",      right: "on, upon" },
      ],
    },
    {
      type: "mcq",
      question: "The word בַּבַּיִת (b'vayit) means:",
      options: ["in the house", "to the house", "from the house", "and a house"],
      correct: "in the house",
      fact: "Prefix ב (in) + definite article ה + בַּיִת (house) = 'in the house'. Hebrew prefixes can incorporate the definite article.",
    },
    {
      type: "wordarrange",
      english: "Construct chain: 'sons of Israel' — בְּנֵי יִשְׂרָאֵל",
      words: ["יִשְׂרָאֵל","בְּנֵי","שֶׁל","עַם","הַ"],
      correct_order: ["בְּנֵי","יִשְׂרָאֵל"],
      hint: "Construct state: noun + noun, the second often takes the definite article.",
    },
  ],

  // Unit 19 — Binyanim
  "verb-binyanim": [
    {
      type: "mcq",
      question: "כָּתַב (katav, 'he wrote') is which binyan?",
      options: ["Pa'al", "Nif'al", "Hif'il", "Pi'el"],
      correct: "Pa'al",
      fact: "Pa'al (Qal) is the basic/simple active binyan. כתב in Pa'al = 'he wrote'. In Nif'al נִכְתַּב = 'it was written'.",
    },
    {
      type: "mcq",
      question: "The causative binyan — 'to cause someone to do X' — is:",
      options: ["Hif'il", "Pi'el", "Hitpa'el", "Pu'al"],
      correct: "Hif'il",
      fact: "Hif'il uses a הי prefix — הִכְתִּיב = 'he dictated' (caused to write).",
    },
    {
      type: "match",
      pairs: [
        { left: "Pa'al",    right: "Basic active — כתב ('wrote')" },
        { left: "Nif'al",   right: "Passive of Pa'al — נִכְתַּב ('was written')" },
        { left: "Pi'el",    right: "Intensive active — דִּבֵּר ('spoke emphatically')" },
        { left: "Hif'il",   right: "Causative — הִכְתִּיב ('dictated')" },
        { left: "Hitpa'el", right: "Reflexive — הִתְקַטֵּב ('corresponded')" },
      ],
    },
  ],
};

// Quick "what is this trope" identification — these are pulled into the trope-catalog screen
export const TROPE_ID_QUIZ = [
  {
    question: "What is the mark under the accented word that ends every Bible verse?",
    options: ["Siluk", "Etnachta", "Merkha", "Pashta"],
    correct: "Siluk",
    fact: "Siluk (with Sof Pasuk) marks the end of every verse. It pairs with Etnachta to form the 'skeleton' of parsing.",
  },
  {
    question: "The 'wavering chain' trope, appearing 4 times in Torah, marks hesitation. Its name:",
    options: ["Shalshelet", "Pashta", "Tevir", "Pazer"],
    correct: "Shalshelet",
    fact: "Shalshelet (Gen 19:16, 24:12, 39:8, Lev 8:23) — its melody slows down the verse to show inner struggle.",
  },
  {
    question: "Which conjunctive trope ALWAYS precedes Pashta?",
    options: ["Mahpakh", "Merkha", "Kadma", "Darga"],
    correct: "Mahpakh",
    fact: "Mahpakh — the triangular 'V' below — always comes before Pashta in the disjunctive chain.",
  },
  {
    question: "The rarest disjunctive trope in the Torah — appearing exactly once at Numbers 35:5:",
    options: ["Karné Parah", "Yerach Ben Yomo", "Merkha Kefula", "Legarmeh"],
    correct: "Karné Parah",
    fact: "Karné Parah (rams' horns) is the rarest disjunctive — only one occurrence in the whole Torah.",
  },
  {
    question: "The 'Resting' conjunctive trope, used to flow into the next disjunctive, is:",
    options: ["Munach", "Kadma", "Merkha Kefula", "Geresh"],
    correct: "Munach",
    fact: "Munach — a small horizontal stroke below — is the 'resting' conjunctive. Very common.",
  },
];
