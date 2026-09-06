// Évite un try/catch répété dans chaque contrôleur : toute exception (synchrone ou
// dans une promesse rejetée) est transmise à errorHandler.js.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
