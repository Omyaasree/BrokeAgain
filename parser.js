(function (root) {
  const CATEGORY_NAMES = [
    'Groceries', 'Dining Out', 'Transportation', 'Shopping', 'Subscriptions',
    'Utilities & Bills', 'Health', 'Travel', 'Entertainment', 'Gifts & Donations',
    'Cash & ATM', 'Fees & Interest', 'Insurance', 'Housing', 'Other',
  ];

  const CATEGORY_RULES = [
    ['Subscriptions', /netflix|spotify|hulu|disney\+|youtube (premium|tv)|icloud|apple\.com\/bill|prime video|patreon|subscription|adobe|openai|chatgpt|anthropic/i],
    ['Groceries', /grocer|whole ?foods|wholefds|trader joe|kroger|safeway|aldi|publix|wegmans|costco|h-e-b|food lion|sprouts/i],
    ['Dining Out', /restaurant|cafe|coffee|starbucks|dunkin|mcdonald|chipotle|doordash|uber ?eats|grubhub|pizza|burger|taco|sushi|bar & grill|dining|wendy|subway|mexican|molcajetes|melt|bizza|ashley/i],
    ['Transportation', /\buber\b|\blyft\b|shell|chevron|exxon|mobil oil|\bbp\b|gas station|parking|toll|transit|clipper|\bmta\b|\bbart\b|fuel/i],
    ['Travel', /airline|airways|\bdelta\b|united air|southwest|hotel|airbnb|expedia|marriott|hilton|booking\.com/i],
    ['Utilities & Bills', /electric|power co|water|gas co|utility|comcast|xfinity|verizon|at&t|t-mobile|mint mobile|spectrum|internet|phone bill/i],
    ['Health', /pharmacy|cvs|walgreens|medical|doctor|dental|clinic|hospital|health|vision|laser/i],
    ['Insurance', /insurance|geico|state farm|progressive|allstate/i],
    ['Housing', /\brent\b|mortgage|apartment|property mgmt|landlord/i],
    ['Entertainment', /cinema|\bamc\b|theat(er|re)|steam|playstation|xbox|nintendo|ticket|concert|bowling|eventbrite/i],
    ['Gifts & Donations', /\bgift|donation|charity|donate|gofundme/i],
    ['Cash & ATM', /\batm\b|cash advance|cash withdrawal/i],
    ['Fees & Interest', /\bfee\b|interest charge|penalty|late charge|overdraft|finance charge/i],
    ['Shopping', /amazon|amzn|ebay|etsy|best buy|target|walmart|nike|h&m|zara|ikea|apple\.com|groupon|sephora|jellycat|store|shop/i],
  ];

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const NUMERIC_DATE = /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}|\d{2}))?$/;
  const AMOUNT = /^[(+-]?\$?[(+-]?\d[\d,]*\.\d{2}\)?[-+]?$/;
  const SKIP = /\b(beginning|ending|previous|new|opening|closing|statement) balance\b|^total\b|minimum (payment|due)|payment due|available (credit|balance)|^balance\b/i;
  const TRANSFER = /\bpayment\b.*\bthank you\b|\bautopay\b|\bautomatic payment\b|\bpayment received\b|\btransfer (to|from)\b|\bonline transfer\b|\bxfer\b|\bcredit card payment\b|\bcard payment\b|credit crd|credit card pmt|\bcrd pmt\b|invest|vanguard|fidelity|schwab|brokerage|robinhood|bkofamerica mobile.*deposit/i;
  const INCOME = /payroll|direct ?dep|\bsalary\b|\bdeposit\b|\brefund\b|\breversal\b|\bcash ?back\b|interest (earned|paid)|\bdividend|zelle (payment )?from|venmo cashout|paycheck/i;
  const CREDIT_HINTS = /credit limit|available credit|minimum payment due|payment due date|annual percentage rate|\bapr\b|purchase apr|cash advance apr|new balance|previous balance/gi;
  const DEBIT_HINTS = /checking account|savings account|beginning balance|ending balance|routing number|deposits and other additions|withdrawals and other (?:subtractions|debits)|overdraft protection/gi;

  function normalizeYear(y) {
    return y.length === 2 ? 2000 + Number(y) : Number(y);
  }

  function readDate(tokens) {
    const first = tokens[0] || '';
    const numeric = first.match(NUMERIC_DATE);
    if (numeric) {
      return { month: Number(numeric[1]), day: Number(numeric[2]), year: numeric[3] ? normalizeYear(numeric[3]) : null, used: 1 };
    }
    const month = MONTHS[first.replace(/\.$/, '').toLowerCase()];
    const day = tokens[1];
    if (month && day && /^\d{1,2},?$/.test(day)) {
      const year = tokens[2];
      if (year && /^\d{4}$/.test(year)) return { month, day: parseInt(day, 10), year: Number(year), used: 3 };
      return { month, day: parseInt(day, 10), year: null, used: 2 };
    }
    return null;
  }

  function takeTrailingAmounts(tokens) {
    const amounts = [];
    let end = tokens.length;
    while (end > 0) {
      let flag = '';
      if (/^(CR|DR)$/i.test(tokens[end - 1]) && end >= 2 && AMOUNT.test(tokens[end - 2])) {
        flag = tokens[end - 1].toUpperCase();
        end--;
      }
      const token = tokens[end - 1];
      if (!token || !AMOUNT.test(token)) break;
      amounts.unshift({
        value: Number(token.replace(/[^0-9.]/g, '')),
        negative: /^[(-]|[)-]$/.test(token),
        credit: flag === 'CR',
      });
      end--;
    }
    return { body: tokens.slice(0, end), amounts };
  }

  function sectionFromHeader(line) {
    if (line.length > 40 || /\d/.test(line) || /balance/i.test(line)) return null;
    const payments = /payments?\b/i.test(line);
    const income = /deposit|credits?\b|money in|additions/i.test(line);
    const expense = /withdraw|debits?\b|purchases?|charges?|transactions?|fees|money out|spending|subtraction/i.test(line);
    if (payments) return 'transfer';
    if (income && expense) return null;
    if (income) return 'income';
    if (expense) return 'expense';
    return null;
  }

  function detectYear(lines) {
    const counts = {};
    for (const line of lines) {
      for (const match of line.matchAll(/(?<![\d.,])(20\d{2})(?![\d.,])/g)) {
        counts[match[1]] = (counts[match[1]] || 0) + 1;
      }
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? Number(best[0]) : new Date().getFullYear();
  }

  function toIso(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function classify(description, amount, section, statementType) {
    if (TRANSFER.test(description)) return 'transfer';
    if (INCOME.test(description) || amount.credit) return 'income';
    if (amount.negative && statementType === 'credit') return 'income';
    return section || 'expense';
  }

  function detectStatementType(pages) {
    const text = pages.flat().join(' ');
    const creditScore = (text.match(CREDIT_HINTS) || []).length;
    const debitScore = (text.match(DEBIT_HINTS) || []).length;
    if (creditScore === debitScore) return null;
    return creditScore > debitScore ? 'credit' : 'debit';
  }

  function categorize(description) {
    for (const [name, pattern] of CATEGORY_RULES) {
      if (pattern.test(description)) return name;
    }
    return 'Other';
  }

  function parse(pages, options = {}) {
    const statementType = options.statementType || 'credit';
    const lines = pages.flat().map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const defaultYear = detectYear(lines);
    const transactions = [];
    let section = null;

    for (const line of lines) {
      const tokens = line.split(' ');
      const date = readDate(tokens);
      if (!date) {
        if (!takeTrailingAmounts(tokens).amounts.length) section = sectionFromHeader(line) || section;
        continue;
      }

      let body = tokens.slice(date.used);
      if (NUMERIC_DATE.test(body[0] || '')) body = body.slice(1);

      const { body: descriptionTokens, amounts } = takeTrailingAmounts(body);
      if (!amounts.length) continue;

      const amount = amounts.length > 1 ? amounts[amounts.length - 2] : amounts[0];
      const description = descriptionTokens.join(' ').trim();
      if (!description || SKIP.test(description) || !(amount.value > 0)) continue;

      const kind = classify(description, amount, section, statementType);
      transactions.push({
        date: toIso(date.year ?? defaultYear, date.month, date.day),
        description,
        amount: amount.value,
        kind,
        category: kind === 'income' ? 'Income' : kind === 'transfer' ? 'Transfer' : categorize(description),
      });
    }

    return transactions.filter(t => t.date);
  }

  const api = { parse, categorize, CATEGORY_NAMES, detectStatementType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StatementParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
