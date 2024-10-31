const { chromium } = require('playwright');
const axios = require('axios');
const { chunkArray, delay, sendLogToSlack, generateCSV, sendErrorLogToSlack } = require('./helpers');

let nitroCacheMiss = [];
let cloudFrontCacheMiss = [];
let csvData = [];
let network2Urls = [];
let logData = [];
let errorLogData = [];

async function warmupUrl(phaseNo, browser, url, needNetwork2 = false) {
    let page;
    let dataCaptured = false;
    
    try {
        // Check if browser is still open
        if (!browser.isConnected()) {
            console.log('Browser is closed. Reopening browser.');
            browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'], headless: true });
        }
        
        page = await browser.newPage();

        page.on('response', async (response) => {
            if (response.url() === url && response.request().resourceType() === 'document') {
                const headers = response.headers();
                const status = response.status();

                const data = {
                    timestamp: new Date().toISOString(),
                    url,
                    status,
                    cloudFrontCacheStatus: headers['x-cache'] || 'N/A',
                    nitroCacheStatus: headers['x-nitro-cache'] || 'N/A',
                    nitroDisabled: headers['x-nitro-disabled'] || 'N/A'
                };

                console.log(`
                    Status: ${status}
                    CloudFront Cache Status: ${data.cloudFrontCacheStatus}
                    Nitro Cache Status: ${data.nitroCacheStatus}
                    Nitro Disabled: ${data.nitroDisabled}
                `);


                csvData.push(data);
                dataCaptured = true;

                if (status === 200 && !headers['x-nitro-disabled']) {
                    if (headers['x-cache'] === 'Miss from cloudfront') {
                        cloudFrontCacheMiss.push(url);
                        if (phaseNo === 2) network2Urls.push(url);
                    }
                    if (headers['x-nitro-cache'] === 'MISS' || !headers['x-nitro-cache']) {
                        nitroCacheMiss.push(url);
                    }
                }
            }
        });

        const timeout = needNetwork2 ? 60000 : 20000;
        const waitUntil = needNetwork2 ? 'networkidle' : 'domcontentloaded';

        await page.goto(url, { waitUntil, timeout });

        if (!dataCaptured) {
            cloudFrontCacheMiss.push(url);
            nitroCacheMiss.push(url);
        }
        
    } catch (error) {
        errorLogData.push(`Error warming up URL: ${url}\n ❌ Error: ${error.message}`);
        if (!dataCaptured) {
            cloudFrontCacheMiss.push(url);
            nitroCacheMiss.push(url);
        }
    } finally {
        console.log('closing the page.')
        if (page) await page.close();
    }
}

async function processChunk(phaseNo, chunk, browser, needNetwork2 = false) {
    //divide the chunk in three parts
    let chunk1 = chunk.slice(0, chunk.length / 3);
    let chunk2 = chunk.slice(chunk.length / 3, 2 * (chunk.length / 3));
    let chunk3 = chunk.slice(2 * (chunk.length / 3), chunk.length);
    let cnt=0;
    // Helper function to process URLs sequentially in each chunk
    const processSequentially = async (chunkPart) => {
        for (const url of chunkPart) {
            cnt++;
            if(phaseNo == 0) 
            console.log(`Processing URL #${cnt}: ${url}`);
            else if (phaseNo == 1)
                console.log(`Processing URL #${cnt} for nitrocache: ${url}`);
            else if (phaseNo == 2)
                console.log(`Processing URL #${cnt} for cloudfront: ${url}`);
            else
                console.log(`Processing URL #${cnt} for network2: ${url}`);

            await warmupUrl(phaseNo, browser, url, needNetwork2);

        }
    };

    // Run the three chunks in parallel
    await Promise.all([
        processSequentially(chunk1),
        processSequentially(chunk2),
        processSequentially(chunk3)
    ]);

    return;
}

async function processUrls(urls, isGlobal = 0) {
    let browser;
    try {
        browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'], headless: true });
        logData.push(`🚀 *Warmup Process Started* 🚀`);
        errorLogData.push(`🚀 ${isGlobal ? 'Global ' : ''} Warmup Process Started 🚀`);
        logData.push(`🌐 *Total URLs:* ${urls.length}`);
        logData.push(`♨️ Starting the warmup process for all URLs.`);
        await sendLogToSlack(logData);
        await sendErrorLogToSlack(errorLogData);

        let urlChunks = chunkArray(urls, 500);
        let cnt = 0;
        
        errorLogData.push(`⚠️ ${isGlobal ? 'Global ' : ''} Warmup Error Log`);
        for (const chunk of urlChunks) {
            cnt+=chunk.length;
            await processChunk(0, chunk, browser);
            logData.push(`🛠️ Processed ${cnt} URLs`);
            await sendLogToSlack(logData);
            await delay(120000);
        }

        await sendErrorLogToSlack(errorLogData);

        const filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_${isGlobal ? 'global_' : ''}first_phase_warmup_report`;
        generateCSV(filename, csvData);
        logData.push(`📄 Completed the first warmup phase. CSV: ${process.env.WEB_URL}:${process.env.PORT}/public/reports/${filename}.csv`);
        await sendLogToSlack(logData);


        nitroCacheMiss = [...new Set(nitroCacheMiss)];
        if (nitroCacheMiss.length > 0) {
            errorLogData.push(`⚠️ ${isGlobal ? 'Global ' : ''} Nitro Cache Warmer Error Log`);
            await processPhase('nitro', 1, browser, isGlobal);
            await sendErrorLogToSlack(errorLogData);
        }


        cloudFrontCacheMiss = [...new Set(cloudFrontCacheMiss)];

        nitroCacheMiss = [];
        network2Urls = [];
        if (cloudFrontCacheMiss.length > 0) {
            errorLogData.push(`⚠️ ${isGlobal ? 'Global ' : ''} CloudFront Cache Warmer Error Log`);
            await processPhase('cloudfront', 2, browser, isGlobal);
            await sendErrorLogToSlack(errorLogData);
        }

        cloudFrontCacheMiss = [];
        network2Urls = [...new Set(network2Urls)];
        if (network2Urls.length > 0) {
            errorLogData.push(`⚠️${isGlobal ? 'Global ' : ''}  Network2 Cache Warmer Error Log`);
            await processPhase('network2', 3, browser, isGlobal, true);
            await sendErrorLogToSlack(errorLogData);
        }

        logData.push(`✅ Completed the warmup process for all URLs.`);
        errorLogData.push(`✅ ${isGlobal ? 'Global ' : ''} Completed the warmup process for all URLs.`);
        console.log(`Completed the warmup process for all URLs.`);
        

    } catch (error) {
        errorLogData.push(`Error processing the URLs: ${error.message}`);
    } finally {
        if (browser) await browser.close();
        await sendLogToSlack(logData);
        await sendErrorLogToSlack(errorLogData);
    }
}

async function processPhase(phaseName, phaseNo, browser, isGlobal, needNetwork2 = false) {
    logData.push(`🌀 Processing ${phaseName} Cache Miss URLs: ${phaseName === 'nitro' ? nitroCacheMiss.length : phaseName === 'cloudfront' ? cloudFrontCacheMiss.length : network2Urls.length} URLs`);
    console.log(` Processing ${phaseName} Cache Miss URLs: ${phaseName === 'nitro' ? nitroCacheMiss.length : phaseName === 'cloudfront' ? cloudFrontCacheMiss.length : network2Urls.length} URLs`);
    
    if(!isGlobal){
        logData.push("⏳ Waiting 5 min before processing...");
        console.log("Waiting 5 min before processing...");
    }
    else if(phaseName==='nitro'){
        logData.push(`⏳ Waiting 1 hr before processing...`);
        console.log(`Waiting 1 hr before processing...`);
    }
    else{
        logData.push(`⏳ Waiting 10 min before processing...`);
        console.log(`Waiting 10 min before processing...`);
    }


    await sendLogToSlack(logData);

    if(!isGlobal)
        await delay(300000); // 5 minutes
    else if(phaseName==='nitro')
        await delay(3600000); // 1 hr
    else
        await delay(600000); // 10 minutes

    const cacheMissUrls = phaseName === 'nitro' ? nitroCacheMiss : phaseName === 'cloudfront' ? cloudFrontCacheMiss : network2Urls;
    console.log(` Processing ${phaseName} Cache Miss URLs: ${cacheMissUrls.length} URLs`);
    const urlChunks = chunkArray(cacheMissUrls, 500);

    //empty the csvData
    csvData = [];
    let cnt = 0;
    for (const chunk of urlChunks) {
        cnt+=chunk.length
        await processChunk(phaseNo, chunk, browser, needNetwork2);
        logData.push(`🛠️ Processed ${cnt} URLs`);
        await sendLogToSlack(logData);
        await delay(120000); // 2 minutes
    }
    const filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_${isGlobal ? 'global_' : ''}${phaseName}_warmup_report`;
    generateCSV(filename, csvData);
    logData.push(`📄 Completed the ${phaseName} warmup process. CSV: ${process.env.WEB_URL}:${process.env.PORT}/public/reports/${filename}.csv`);
    await sendLogToSlack(logData);
}

module.exports = { processUrls };
