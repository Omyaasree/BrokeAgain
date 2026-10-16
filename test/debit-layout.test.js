const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../parser.js');

const sum = (txs, kind) => txs.filter(t => t.kind === kind).reduce((s, t) => s + t.amount, 0);

test('debit statement layout with deposit, ATM/debit, and other subtraction sections', () => {
  const txs = parse([[
    'Account summary',
    'Beginning balance on August 21, 2026 $100.00',
    'Deposits and other additions',
    'Date Description Amount',
    '08/21/26 MPHASIS CORPORAT DES:PAYROLL ID:657100407610QVW CO 635.19',
    'ID:9111111103 PPD',
    '09/18/26 BKOFAMERICA MOBILE 09/19 3653608201 DEPOSIT *MOBILE CA 1,877.00',
    'Total deposits and other additions $2,512.19',
    'ATM and debit card subtractions',
    'Date Description Amount',
    '09/04/26 MOBILE PURCHASE 0904 San Jose San Jose CA -2.25',
    '09/08/26 PURCHASE 0904 MINT MOBILE 800-683-7392 CA -21.00',
    'Total ATM and debit card subtractions -$23.25',
    'Other subtractions',
    'Date Description Amount',
    '08/27/26 Zelle payment to EDWARD SHTURMAN Conf# gs44d86ow -16.00',
    '09/10/26 VANGUARD BUY DES:INVESTMENT ID:925966447150954 CO -2,500.00',
    '09/10/26 CHASE CREDIT CRD DES:EPAY ID:9693060137 CO -1,188.34',
    'Total other subtractions -$3,704.34',
  ]], { statementType: 'debit' });

  assert.equal(txs.length, 7);
  assert.equal(sum(txs, 'income').toFixed(2), '635.19');
  assert.equal(sum(txs, 'expense').toFixed(2), '1916.25');
  assert.equal(sum(txs, 'transfer').toFixed(2), '3688.34');

  const mobile = txs.find(t => t.description.startsWith('MOBILE PURCHASE'));
  assert.equal(mobile.category, 'Other');
  assert.equal(txs.find(t => t.description.includes('MINT MOBILE')).category, 'Utilities & Bills');
  const bofaDeposit = txs.find(t => t.description.startsWith('BKOFAMERICA MOBILE'));
  assert.equal(bofaDeposit.kind, 'expense');
  assert.equal(bofaDeposit.category, 'Credit Card Payment');
});
