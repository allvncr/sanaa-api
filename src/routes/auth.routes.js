const express = require('express');
const Joi = require('joi');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const authentifier = require('../middlewares/auth');
const validate = require('../middlewares/validate');

router.post(
  '/login',
  validate(Joi.object({ email: Joi.string().email().required(), mot_de_passe: Joi.string().min(6).required() })),
  ctrl.login
);
router.post('/refresh', validate(Joi.object({ refreshToken: Joi.string().required() })), ctrl.refresh);
router.post('/logout', authentifier, ctrl.logout);
router.get('/me', authentifier, ctrl.me);

module.exports = router;
