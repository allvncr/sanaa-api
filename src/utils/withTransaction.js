const mongoose = require('mongoose');
const logger = require('./logger');

/**
 * Exécute `fn(session)` dans une transaction MongoDB multi-documents (section 2.3,
 * 3.9) quand le serveur le permet (replica set, recommandé dès la V0 — section 2.7).
 * Se replie silencieusement sur une exécution sans session en local mono-nœud
 * (MongoDB standalone, courant en développement) pour ne pas bloquer le
 * développement local — un standalone ne supporte pas nativement les transactions.
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let resultat;
    await session.withTransaction(async () => {
      resultat = await fn(session);
    });
    return resultat;
  } catch (err) {
    const messagesStandalone = ['Transaction numbers', 'IllegalOperation', 'replica set'];
    const estStandalone = messagesStandalone.some((m) => (err.message || '').includes(m));
    if (!estStandalone) throw err;
    logger.warn('Transactions MongoDB indisponibles (instance standalone) — exécution sans session.');
    return fn(null);
  } finally {
    await session.endSession();
  }
}

module.exports = withTransaction;
