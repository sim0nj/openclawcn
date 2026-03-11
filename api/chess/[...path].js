const { proxyRequest } = require('../_proxy');

module.exports = async function handler(req, res) {
  await proxyRequest(req, res, process.env.CHESS_SERVICE_URL);
};

module.exports.config = {
  api: {
    bodyParser: true,
    responseLimit: false
  }
};
