const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, detectStatementType } = require('../parser.js');

const pick = (txs, desc) => txs.find(t => t.description.startsWith(desc));

test('credit card: purchases, payment, and refund', () => {
  const txs = parse([[
    'Statement period 06/01/2026 - 06/30/2026',
    'Previous balance $1,200.00',
    'Payments',
    '06/03 PAYMENT THANK YOU -500.00',
    'Purchases',
    '06/05 TRADER JOE #123 SAN DIEGO CA 84.32',
    '06/07 AMAZON MKTPLACE PMTS 23.99',
    '06/09 UBER EATS 31.10',
    '06/10 AMAZON RETURN -12.00',
    'New balance $742.41',
  ]], { statementType: 'credit' });

  assert.equal(txs.length, 5);
  assert.deepEqual(pick(txs, 'PAYMENT'), { date: '2026-06-03', description: 'PAYMENT THANK YOU', amount: 500, kind: 'transfer', category: 'Transfer' });
  assert.deepEqual(pick(txs, 'TRADER JOE'), { date: '2026-06-05', description: 'TRADER JOE #123 SAN DIEGO CA', amount: 84.32, kind: 'expense', category: 'Groceries' });
  assert.equal(pick(txs, 'AMAZON MKTPLACE').category, 'Shopping');
  assert.equal(pick(txs, 'UBER EATS').category, 'Dining Out');
  assert.equal(pick(txs, 'AMAZON RETURN').kind, 'income');
});

test('debit statement: sections, two-amount rows, and ATM withdrawal', () => {
  const txs = parse([[
    'Account statement 06/01/2026 through 06/30/2026',
    'Deposits and Additions',
    '06/01 PAYROLL ACME INC 2,500.00',
    '06/02 VENMO CASHOUT 40.00',
    'Withdrawals and Debits',
    '06/03 SAFEWAY 0123 54.20 1,000.00',
    '06/04 RENT PAYMENT ACH 1,200.00',
    '06/05 TRANSFER TO SAVINGS 300.00',
    '06/06 ATM WITHDRAWAL -40.00',
  ]], { statementType: 'debit' });

  assert.equal(pick(txs, 'PAYROLL').kind, 'income');
  assert.equal(pick(txs, 'VENMO').kind, 'income');
  assert.equal(pick(txs, 'SAFEWAY').amount, 54.2);
  assert.equal(pick(txs, 'SAFEWAY').category, 'Groceries');
  assert.equal(pick(txs, 'RENT PAYMENT').category, 'Housing');
  assert.equal(pick(txs, 'TRANSFER TO SAVINGS').kind, 'transfer');
  assert.equal(pick(txs, 'ATM WITHDRAWAL').kind, 'expense');
  assert.equal(pick(txs, 'ATM WITHDRAWAL').category, 'Cash & ATM');
});

test('BKOFAMERICA MOBILE deposit lines are treated as a credit card payment expense, not income', () => {
  const txs = parse([[
    'Deposits and other additions',
    '09/18/26 BKOFAMERICA MOBILE 09/19 3653608201 DEPOSIT *MOBILE CA 1,877.00',
  ]], { statementType: 'debit' });

  assert.equal(txs.length, 1);
  assert.equal(txs[0].kind, 'expense');
  assert.equal(txs[0].category, 'Credit Card Payment');
});

test('alternate date formats: month names, posting dates, and skipped balance lines', () => {
  const txs = parse([[
    'Jun 3, 2026 STARBUCKS 5.45',
    '06/07 06/08 TARGET 15.00',
    'Ending balance 2,000.00',
    '06/09/2026 ZELLE PAYMENT FROM JO SMITH 75.00',
  ]], { statementType: 'debit' });

  assert.equal(txs.length, 3);
  assert.deepEqual(txs.map(t => t.date), ['2026-06-03', '2026-06-07', '2026-06-09']);
  assert.equal(pick(txs, 'STARBUCKS').category, 'Dining Out');
  assert.equal(pick(txs, 'TARGET').description, 'TARGET');
  assert.equal(pick(txs, 'ZELLE').kind, 'income');
});

test('detectStatementType recognizes credit card wording', () => {
  const type = detectStatementType([[
    'Account Summary',
    'Previous Balance $1,200.00',
    'Minimum Payment Due $35.00',
    'Payment Due Date 07/15/2026',
    'Credit Limit $10,000.00',
    'Available Credit $8,800.00',
    'Purchase APR 24.99%',
    'New Balance $742.41',
  ]]);
  assert.equal(type, 'credit');
});

test('detectStatementType recognizes checking/debit wording', () => {
  const type = detectStatementType([[
    'Account Summary',
    'Beginning balance on August 21, 2026 $8,233.78',
    'Ending balance on September 21, 2026 $9,388.93',
    'Deposits and other additions 5,812.53',
    'Withdrawals and other subtractions -926.04',
    'Checking Account',
    'Routing Number 123456789',
  ]]);
  assert.equal(type, 'debit');
});

test('detectStatementType returns null when there is no clear signal', () => {
  assert.equal(detectStatementType([['Thank you for your business', '06/01 COFFEE SHOP 4.50']]), null);
});
