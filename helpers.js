const axios = require('axios');
const fs = require('fs');
const path = require('path');

function generateCSV(filename, data) {
    // Define the directory path inside the public folder
    const dirPath = path.join(__dirname, 'public', 'reports');

    // Ensure the reports directory exists, if not create it
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // Define the full file path inside the reports folder
    const filePath = path.join(dirPath, `${filename}.csv`);

    // CSV Headers (adjust based on your data)
    const headers = ['Timestamp', 'URL', 'Status', 'CloudFront-Cache-Status', 'Nitro-Cache-Status', 'x-Nitro-Disabled'];

    // If data is an array of objects, map it to an array of arrays
    const rows = data.map(row => {
        if (Array.isArray(row)) {
            // If the row is already an array, return it as-is
            return row;
        } else if (typeof row === 'object') {
            // If the row is an object, map the object fields to an array in the order of the headers
            return [
                row.timestamp || '',
                row.url || '',
                row.status || '',
                row.cloudFrontCacheStatus || '',
                row.nitroCacheStatus || '',
                row.nitroDisabled || ''
            ];
        } else {
            // If the row is not an array or object, throw an error
            throw new Error('Invalid data format for CSV generation');
        }
    });

    // Join headers and rows into CSV format
    const csvRows = [
        headers.join(','),  // Join headers as the first row
        ...rows.map(row => row.join(','))  // Map each row and join columns by commas
    ].join('\n');

    // Write the CSV content to a file
    fs.writeFileSync(filePath, csvRows, 'utf8');
    console.log(`${filename} saved successfully at ${filePath}`);
}

// Helper function to divide array into chunks
function chunkArray(arr, chunkSize) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
}

// Function to introduce delay between URL processing
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// const delay = (ms) => new Promise(resolve => setTimeout(resolve, 0));

// Function to send log data to Slack
async function sendLogToSlack(logData) {
    const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    const logChunks = chunkArray(logData, 20);

    for (const chunk of logChunks) {
        try {
            const payload = { text: `*Cache Warmer* \n\n${chunk.join('\n')}` };
            await axios.post(SLACK_WEBHOOK_URL, payload);
            logData.length = 0;
        } catch (error) {
            console.error('Error sending logs to Slack:', error.message);
        }
    }
}

//Function to send the error log to slack
async function sendErrorLogToSlack(logData) {
    const SLACK_WEBHOOK_URL = process.env.ERROR_SLACK_WEBHOOK_URL;
    const logChunks = chunkArray(logData, 20);

    for (const chunk of logChunks) {
        try {
            const payload = { text: `Cache Warmer \n\n${chunk.join('\n')}` };
            await axios.post(SLACK_WEBHOOK_URL, payload);
            logData.length = 0;
        } catch (error) {
            console.error('Error sending logs to Slack:', error.message);
        }
    }
}

const deleteOldFiles = (directory) => {
    const oneMonth = process.env.EXPIRE_TIME || 30 * 24 * 60 * 60 * 1000; // Default to 30 days
    const now = Date.now();
    const deletedFiles = [];

    // Read all files in the directory
    fs.readdir(directory, (err, files) => {
        if (err) {
            console.error(`Error reading directory: ${err}`);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(directory, file);

            // Get file stats to check the last modified time
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error(`Error getting stats for file: ${filePath} - ${err}`);
                    return;
                }

                const fileAge = now - stats.mtimeMs; // Time since the file was modified

                //log the file age in minutes
                console.log(`File: ${filePath} is ${fileAge / 1000 / 60} minutes old`);

                if (fileAge > oneMonth) {
                    // Delete the file if it's older than one month
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error(`Error deleting file: ${filePath} - ${err}`);
                        } else {
                            console.log(`Deleted file: ${filePath}`);
                            deletedFiles.push(file);
                        }
                    });
                }
            });
        });
    });

    return deletedFiles;
};


module.exports = { chunkArray, delay, sendLogToSlack,generateCSV,deleteOldFiles, sendErrorLogToSlack };
