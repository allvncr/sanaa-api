const asyncHandler = require('../utils/asyncHandler');
const { sendOne } = require('../utils/apiResponse');
const authService = require('../services/auth.service');

const login = asyncHandler(async (req, res) => {
  const { email, mot_de_passe } = req.body;
  const { accessToken, refreshToken, utilisateur } = await authService.login(email, mot_de_passe);
  sendOne(res, { accessToken, refreshToken, utilisateur });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken);
  sendOne(res, result);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id);
  sendOne(res, { ok: true });
});

const me = asyncHandler(async (req, res) => {
  const utilisateur = await authService.me(req.user.id);
  sendOne(res, utilisateur);
});

module.exports = { login, refresh, logout, me };
