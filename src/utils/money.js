const Decimal = require('decimal.js');
const mongoose = require('mongoose');

// Les montants financiers ne doivent jamais transiter par le type Number natif de
// JavaScript (section 3.9, section 2.3) : toute somme/soustraction/multiplication
// passe par decimal.js, la persistance passant par Decimal128 (Mongoose).

function toDecimal(value) {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof mongoose.Types.Decimal128) return new Decimal(value.toString());
  return new Decimal(value.toString());
}

function toDecimal128(decimalValue) {
  return mongoose.Types.Decimal128.fromString(new Decimal(decimalValue).toFixed(4));
}

function sum(values) {
  return values.reduce((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b));
}

module.exports = { Decimal, toDecimal, toDecimal128, sum, multiply };
