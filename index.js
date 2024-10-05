const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path'); 
const warmupRoutes = require('./routes/warmupRoutes');
const { validateApiKey } = require('./middleware');
const cors = require('cors');



// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Enable CORS for all routes
// Middleware to parse JSON requests
app.use(bodyParser.json());

// Serve static files from the "public" folder
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/health', validateApiKey, (req, res) => {
    res.status(200).send('Healthy');
});

// Routes
app.use('/warmup', validateApiKey, warmupRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.send('Api service is running');
});

// Start the server
app.listen(port, '0.0.0.0',() => {
    console.log(`Server is running on port ${port}`);
});
