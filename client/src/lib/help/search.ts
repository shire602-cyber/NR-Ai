/**
 * Client-side help search with Arabic-aware normalisation. Everything is
 * matched in a folded form: lower case, no diacritics or tatweel, alef and
 * yeh/teh-marbuta variants merged, Arabic-Indic digits turned into ASCII.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normaliseSearch(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/[آأإٱ]/g, "ا") // alef variants -> alef
    .replace(/ى/g, "ي") // alef maqsura -> yeh
    .replace(/ة/g, "ه") // teh marbuta -> heh
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenise(query: string): string[] {
  const folded = normaliseSearch(query);
  return folded ? folded.split(" ") : [];
}

export interface SearchableArticle {
  slug: string;
  title: string;
  summary: string;
  keywords: string[];
  body: string;
}

export interface SearchHit<T extends SearchableArticle> {
  article: T;
  score: number;
}

const WEIGHT = { title: 8, keywords: 5, summary: 3, body: 1 } as const;

/** Prefix match against whole words, so "inv" finds "invoices" but "voice" does not. */
function matchesWord(haystack: string, token: string): boolean {
  if (haystack.startsWith(token) || haystack.includes(` ${token}`)) return true;
  // Arabic attaches the definite article and prepositions as prefixes (الفواتير, للفواتير, بالفواتير).
  return /[؀-ۿ]/.test(token) && (haystack.includes(`ال${token}`) || haystack.includes(` ${token}`));
}

/**
 * Every query word must match somewhere (AND); the score adds up where each
 * word matched. Results are sorted by score, then title. An empty query keeps
 * the input order.
 */
export function searchArticles<T extends SearchableArticle>(
  articles: readonly T[],
  query: string
): SearchHit<T>[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return articles.map((article) => ({ article, score: 0 }));
  const hits: SearchHit<T>[] = [];
  for (const article of articles) {
    const fields = {
      title: normaliseSearch(article.title),
      keywords: normaliseSearch(article.keywords.join(" ")),
      summary: normaliseSearch(article.summary),
      body: normaliseSearch(article.body),
    };
    let score = 0;
    let all = true;
    for (const token of tokens) {
      let tokenScore = 0;
      for (const field of Object.keys(WEIGHT) as Array<keyof typeof WEIGHT>) {
        if (matchesWord(fields[field], token)) tokenScore += WEIGHT[field];
      }
      if (tokenScore === 0) {
        all = false;
        break;
      }
      score += tokenScore;
    }
    if (all) hits.push({ article, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
}

/** The search a `/help?q=...` link asks for: trimmed and capped; empty when the query has none. */
export function helpQueryFromSearch(search: string): string {
  return (new URLSearchParams(search).get("q") ?? "").trim().slice(0, 100);
}
