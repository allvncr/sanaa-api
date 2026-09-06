const Role = require('../models/Role');

async function lister() {
  return Role.find().sort({ nom: 1 });
}

async function creer(data) {
  return Role.create(data);
}

module.exports = { lister, creer };
