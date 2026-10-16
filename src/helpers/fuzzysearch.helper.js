/**
 * Typo-tolerant search for invoices and leads: builds the hidden searchIndex (phonetic keys,
 * trigrams, digits) and ranks matches.
 *
 * Exports: escapeRegex, normalizeText, phoneticKey, trigrams, buildSearchIndex,
 * buildInvoiceSearchIndex, buildClientSearchIndex, parseQuery and 2 more
 * Used by: models/invoice.model.js, models/lead.model.js, services/invoice/invoice.service.js,
 * services/lead/lead.service.js
 */

/* =========================================================================
   FUZZY SEARCH — finds results even with spelling mistakes
   (works on normal MongoDB; Atlas Search is not needed)

   Every document stores a hidden `searchIndex` field:
     text   → normalized text            "ramesh dental clinic inv 2026 0012"
     keys   → phonetic keys per word     ["rms", "dntl", "clnc", ...]
     grams  → 3-letter pieces per word   ["ram","ame","mes","esh", ...]
     digits → phone / invoice no. digits "9876543210 20260012"

   Search runs in 2 steps:
     1. MongoDB finds candidates (phonetic key / trigram / digits match).
        These fields are indexed, so it stays fast with thousands of invoices.
     2. JavaScript scores each candidate (Levenshtein + phonetic) and puts
        the best match first.

   Examples that match:
     "Mehta" ⇄ "Maheta" ⇄ "Mheta"      "Agarwal" ⇄ "Aggarwal" ⇄ "Agrawal"
     "Isha"  ⇄ "Esha"                  "Shailesh" ⇄ "Sailesh"
     "rmesh" ⇄ "Ramesh"                "98765 43210" ⇄ "+91-9876543210"
   ========================================================================= */

/**
 * Escape regex.
 *
 * @param {*} s
 * @returns {*}
 */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalize text.
 *
 * @param {*} s
 * @returns {*}
 */
export const normalizeText = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// common spelling variants of Indian names end up on the same key
const SOUND_RULES = [
  [/ph/g, "f"],
  [/ck/g, "k"],
  [/q/g, "k"],
  [/x/g, "ks"],
  [/w/g, "v"],
  [/z/g, "j"],
  [/sh/g, "s"],
  [/kh/g, "k"],
  [/gh/g, "g"],
  [/th/g, "t"],
  [/dh/g, "d"],
  [/bh/g, "b"],
  [/ch/g, "c"],
  [/jh/g, "j"],
];

/**
 * Phonetic key.
 *
 * @param {*} word
 * @returns {*}
 */
export const phoneticKey = (word) => {
  let w = String(word || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return "";
  for (const [re, rep] of SOUND_RULES) w = w.replace(re, rep);
  w = w.replace(/h/g, "").replace(/(.)\1+/g, "$1");
  if (!w) return "";
  const first = /[aeiou]/.test(w[0]) ? "a" : w[0]; // Isha/Esha → same
  const key = (first + w.slice(1).replace(/[aeiouy]/g, "")).replace(/(.)\1+/g, "$1");
  // a very short key (e.g. "Shah" → "s") would match everything, so keep the vowel
  return key.length >= 2 ? key : (first + w.slice(1)).replace(/(.)\1+/g, "$1");
};

/**
 * Trigrams.
 *
 * @param {*} w
 * @returns {*}
 */
export const trigrams = (w) => {
  if (!w) return [];
  if (w.length < 3) return [w];
  const out = [];
  for (let i = 0; i <= w.length - 3; i++) out.push(w.slice(i, i + 3));
  return out;
};

/**
 * Build search index.
 *
 * @param {*} [values]
 * @returns {*}
 */
export const buildSearchIndex = (values = []) => {
  const text = normalizeText(values.filter(Boolean).join(" "));
  const words = [...new Set(text.split(" ").filter(Boolean))];
  const keys = new Set();
  const grams = new Set();
  for (const w of words) {
    if (/^\d+$/.test(w)) continue;
    const k = phoneticKey(w);
    if (k) keys.add(k);
    for (const g of trigrams(w)) grams.add(g);
  }
  const digits = values
    .map((v) => String(v ?? "").replace(/\D/g, ""))
    .filter((d) => d.length >= 3)
    .join(" ");
  return { text, keys: [...keys], grams: [...grams], digits };
};

/* ---------- what goes into the index ---------- */
/**
 * Build invoice search index.
 *
 * @param {*} inv
 * @returns {*}
 */
export const buildInvoiceSearchIndex = (inv) =>
  buildSearchIndex([
    inv.invoiceNumber,
    inv.orderNumber,
    inv.clientId,
    inv.billTo?.companyName,
    inv.billTo?.contactPerson,
    inv.billTo?.contactNumber,
    inv.billTo?.gstin,
    inv.createdByName,
  ]);

/**
 * Build client search index.
 *
 * @param {*} lead
 * @returns {*}
 */
export const buildClientSearchIndex = (lead) =>
  buildSearchIndex([
    lead.clientId,
    lead.doctorName,
    lead.clinicName,
    lead.contact,
    String(lead.email || "").split("@")[0], // skip "gmail com" noise
    lead.city,
    lead.state,
  ]);

/* ---------- scoring ---------- */
const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};
const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/**
 * Parse query.
 *
 * @param {*} q
 * @returns {*}
 */
export const parseQuery = (q) => {
  const text = normalizeText(q);
  if (!text) return null;
  const words = text.split(" ").filter(Boolean);
  const alphaWords = words.filter((w) => !/^\d+$/.test(w));
  const digits = String(q).replace(/\D/g, "");
  const keys = [...new Set(alphaWords.map(phoneticKey).filter(Boolean))];
  const grams = [...new Set(alphaWords.flatMap(trigrams))];

  const or = [{ "searchIndex.text": { $regex: escapeRegex(text) } }];
  if (keys.length) or.push({ "searchIndex.keys": { $in: keys } });
  if (grams.length) or.push({ "searchIndex.grams": { $in: grams } });
  if (digits.length >= 3) or.push({ "searchIndex.digits": { $regex: escapeRegex(digits) } });

  return { text, alphaWords, digits, keys, grams, or };
};

const WORD_CUTOFF = 0.7; // a word less similar than this is not a match

/**
 * Score document.
 *
 * @param {*} index
 * @param {*} parsed
 * @returns {*}
 */
export const scoreDoc = (index, parsed) => {
  if (!index) return 0;
  const docText = index.text || "";
  const docWords = docText.split(" ").filter(Boolean);
  let score = 0;

  if (parsed.text && docText.includes(parsed.text)) score += 100;
  // 4+ digits (part of a phone / invoice no.) are enough for a match on their own;
  // 2-3 digits occur in every phone number, so they only help the ranking
  if (parsed.digits.length >= 2 && (index.digits || "").includes(parsed.digits)) {
    score += parsed.digits.length >= 4 ? 90 : 25;
  }

  if (parsed.alphaWords.length) {
    let total = 0;
    for (const qw of parsed.alphaWords) {
      const qk = phoneticKey(qw);
      let best = 0;
      for (const dw of docWords) {
        let s;
        if (dw === qw) s = 1;
        else if (qw.length >= 2 && dw.startsWith(qw)) s = 0.9;
        else if (dw.length >= 5 && qw.startsWith(dw)) s = 0.8;
        else {
          s = similarity(qw, dw);
          if (qk && qk.length >= 2 && phoneticKey(dw) === qk) s = Math.max(s, 0.85);
        }
        if (s > best) best = s;
        if (best === 1) break;
      }
      total += best;
    }
    const avg = total / parsed.alphaWords.length;
    if (avg >= WORD_CUTOFF) score += avg * 80;
  }
  return score;
};

/**
 * Generic fuzzy search on any model that has `searchIndex`.
 * filter  → normal mongo filter (role scope, status, dates...). This is an aggregate,
 *           so pass ObjectIds already cast.
 * project → optional inclusion projection (to skip heavy arrays)
 */
export const fuzzySearch = async (
  Model,
  { filter = {}, q, skip = 0, limit = 20, project = null, candidateLimit = 400, minScore = 50 }
) => {
  const parsed = parseQuery(q);
  if (!parsed) return { items: [], total: 0 };

  const pipeline = [
    { $match: { $and: [filter, { $or: parsed.or }] } },
    {
      $addFields: {
        _keyHits: { $size: { $setIntersection: [{ $ifNull: ["$searchIndex.keys", []] }, parsed.keys] } },
        _gramHits: { $size: { $setIntersection: [{ $ifNull: ["$searchIndex.grams", []] }, parsed.grams] } },
      },
    },
    { $sort: { _keyHits: -1, _gramHits: -1, createdAt: -1 } },
    { $limit: candidateLimit },
  ];
  if (project) pipeline.push({ $project: { ...project, searchIndex: 1, createdAt: 1 } });

  const candidates = await Model.aggregate(pipeline);

  const ranked = candidates
    .map((d) => ({ d, s: scoreDoc(d.searchIndex, parsed) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s || new Date(b.d.createdAt) - new Date(a.d.createdAt));

  const items = ranked.slice(skip, skip + limit).map(({ d, s }) => {
    const { searchIndex, _keyHits, _gramHits, ...rest } = d;
    return { ...rest, matchScore: Math.round(s) };
  });

  return { items, total: ranked.length };
};
