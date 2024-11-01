function validateApiKey(req, res, next) {
    const apiKey = req.headers['api-key'];
    if (apiKey !== process.env.API_KEY) {
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    next();
}

function validateGlobalAccess(req, res, next) {
    const apiKey = req.headers['api-key'];
    if (apiKey !== process.env.GLOBAL_ACCESS_KEY) {
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    next();
}

module.exports = { validateApiKey, validateGlobalAccess };
