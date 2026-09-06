const { AsyncLocalStorage } = require('node:async_hooks');

// Porte le contexte de la requête (utilisateur courant, pays autorisés) à travers
// toute la pile d'appels asynchrone, pour que les plugins Mongoose (scoping pays,
// journal d'activité) puissent y accéder sans que chaque service ait à le transmettre
// explicitement en paramètre — section 3.9 et 4.3 du document d'architecture.
const als = new AsyncLocalStorage();

function run(context, fn) {
  return als.run(context, fn);
}

function getContext() {
  return als.getStore() || null;
}

function getCurrentUser() {
  const ctx = getContext();
  return ctx ? ctx.user : null;
}

module.exports = { run, getContext, getCurrentUser };
