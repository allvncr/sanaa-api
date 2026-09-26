const asyncHandler = require('../utils/asyncHandler');
const { sendOne } = require('../utils/apiResponse');
const service = require('../services/suivi.service');

const suivre = asyncHandler(async (req, res) =>
  sendOne(res, await service.suivre(req.params.numero, req.query.telephone))
);

module.exports = { suivre };
