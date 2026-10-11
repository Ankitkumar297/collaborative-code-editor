const rules = {
  python: [
    [/^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:/m, 7],
    [/^\s*class\s+\w+(?:\([^)]*\))?\s*:/m, 6],
    [/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/m, 7],
    [/^\s*from\s+[\w.]+\s+import\s+/m, 5],
    [/^\s*elif\s+.+:/m, 4],
    [/^\s*for\s+.+\s+in\s+.+:/m, 5],
    [/^\s*while\s+.+:/m, 4],
    [/\brange\s*\(/, 4],
    [/\binput\s*\(/, 4],
    [/\bself\.[A-Za-z_]\w*/m, 3],
    [/\b(?:None|True|False)\b/, 2],
    [/\bprint\s*\(/, 4],
  ],
  typescript: [
    [/^\s*(?:export\s+)?interface\s+\w+/m, 7],
    [/^\s*(?:export\s+)?type\s+\w+\s*=/m, 6],
    [/^\s*(?:export\s+)?enum\s+\w+/m, 6],
    [/\b(?:const|let|var)\s+\w+\s*:\s*(?:string|number|boolean|unknown|any|[A-Z]\w*)\b/, 6],
    [/\)\s*:\s*(?:string|number|boolean|void|Promise|[A-Z]\w*)\b/, 5],
    [/\bas\s+(?:const|string|number|boolean|[A-Z]\w*)\b/, 4],
  ],
  java: [
    [/\bpublic\s+static\s+void\s+main\s*\(\s*String\s*(?:\[\s*\]|\.\.\.)\s*\w+\s*\)/, 9],
    [/\bSystem\s*\.\s*out\s*\./, 7],
    [/^\s*(?:package|import)\s+[\w.]+(?:\.\*)?\s*;/m, 5],
    [/\bnew\s+Scanner\s*\(/, 4],
    [/\bpublic\s+(?:abstract\s+)?class\s+\w+/, 5],
  ],
  csharp: [
    [/^\s*using\s+System(?:\.[\w.]+)?\s*;/m, 7],
    [/\bConsole\s*\.\s*(?:WriteLine|ReadLine|Write)\s*\(/, 7],
    [/\bnamespace\s+[\w.]+\s*\{/m, 5],
    [/\b(?:string|int|bool)\s*\[\s*\]\s+args\b/, 5],
    [/\b(?:public|private|protected|internal)\s+static\s+void\s+Main\s*\(/, 6],
  ],
  cpp: [
    [/^\s*#\s*include\s*[<"](?:iostream|vector|string|algorithm|bits\/stdc\+\+)\b[^>"\n]*[>"]/m, 8],
    [/\busing\s+namespace\s+std\s*;/, 7],
    [/\bstd\s*::\s*\w+/, 5],
    [/\b(?:cout|cin)\s*(?:<<|>>)/, 6],
    [/\btemplate\s*</, 5],
  ],
  c: [
    [/^\s*#\s*include\s*[<"](?:stdio|stdlib|string|math|stdbool)\.h[>"]/m, 8],
    [/\b(?:printf|scanf|fopen|malloc)\s*\(/, 4],
    [/\b(?:int|void|char)\s+main\s*\(/, 3],
  ],
  node: [
    [/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/, 5],
    [/\bmodule\s*\.\s*exports\b/, 7],
    [/\bprocess\s*\.\s*(?:env|argv|exit)\b/, 5],
    [/\b__dirname\b|\b__filename\b/, 6],
  ],
  javascript: [
    [/\bconsole\s*\.\s*(?:log|error|warn)\s*\(/, 5],
    [/^\s*(?:export\s+default|export\s+(?:const|function|class))\b/m, 5],
    [/\b(?:const|let|var)\s+\w+\s*=/, 3],
    [/\bfunction\s+\w+\s*\(/, 4],
    [/=>/, 3],
  ],
};

export const detectLanguage = (source, currentLanguage = 'javascript') => {
  const code = String(source || '').trim();
  if (code.length < 7) return null;

  const scores = Object.entries(rules).map(([language, languageRules]) => ({
    language,
    score: languageRules.reduce((total, [pattern, weight]) => total + (pattern.test(code) ? weight : 0), 0),
  })).sort((left, right) => right.score - left.score);

  const [best, second] = scores;
  if (best.score < 4 || best.score - second.score < 2) return null;
  if (best.language === currentLanguage) return null;
  return best.language;
};
