export type StrengthLevel = 0 | 1 | 2 | 3;

export interface Strength {
  /** 0 : trop court, 1 : faible, 2 : moyen, 3 : solide. */
  level: StrengthLevel;
  label: string;
  hint: string;
}

const LABELS = ["Trop court", "Faible", "Moyen", "Solide"] as const;

const COMMON = ["password", "motdepasse", "azerty", "qwerty", "123456", "000000", "111111", "abc123", "iloveyou", "clash", "soleil", "bonjour", "admin"];

/** Suite de 4 caractères consécutifs (abcd, 1234, dcba) ou répétés (aaaa). */
function hasRun(s: string): boolean {
  for (let i = 0; i + 3 < s.length; i++) {
    const c = [0, 1, 2, 3].map((k) => s.charCodeAt(i + k));
    const d = c[1] - c[0];
    if (Math.abs(d) <= 1 && c[2] - c[1] === d && c[3] - c[2] === d) return true;
  }
  return false;
}

/**
 * Estimation simple et locale, pour guider la saisie. Le serveur n'impose que 8 caractères.
 * Longueur et variété comptent ; mots courants, suites et pseudo recopié font baisser la note.
 */
export function passwordStrength(password: string, username = ""): Strength {
  if (password.length < 8) return { level: 0, label: LABELS[0], hint: "8 caractères au moins." };
  const lower = password.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;

  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  if (new Set(password).size >= 8) score++;

  const weak = COMMON.some((w) => lower.includes(w)) || hasRun(lower) || (username.length >= 3 && lower.includes(username.toLowerCase()));
  if (weak) score -= 2;

  const level: StrengthLevel = score >= 4 ? 3 : score >= 2 ? 2 : 1;
  const hint =
    level === 3
      ? "Parfait."
      : weak
        ? "Évite les mots courants, les suites (1234, abcd) et ton pseudo."
        : "Allonge-le ou mélange lettres, chiffres et symboles.";
  return { level, label: LABELS[level], hint };
}
