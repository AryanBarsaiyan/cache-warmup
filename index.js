const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path'); 
const warmupRoutes = require('./routes/warmupRoutes');
const { validateApiKey } = require('./middleware');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(bodyParser.json());

// Serve static files from the "public" folder
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('Healthy');
});

// Routes
app.use('/warmup', validateApiKey, warmupRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.send('Api service is running');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
