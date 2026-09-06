function sendList(res, data, meta = {}) {
  return res.json({ data, meta });
}

function sendOne(res, data, status = 200) {
  return res.status(status).json({ data });
}

module.exports = { sendList, sendOne };
