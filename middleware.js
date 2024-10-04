function validateApiKey(req, res, next) {
    console.log('Validating API Key');
    const apiKey = req.headers['api-key'];
    if (apiKey !== process.env.API_KEY) {
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    next();
}

module.exports = { validateApiKey };
