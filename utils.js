const puppeteer = require('puppeteer');
const axios = require('axios');
const { chunkArray, delay, sendLogToSlack, generateCSV } = require('./helpers');


async function warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData, retryCount = 0) {
    const maxRetries = 3; // Set the maximum number of retries
    try {
        let ttfb = 0;
        let dnsLookupTime = 0;
        let pageLoadTime = 0;
        let dataCaptured = false; // Flag to track if necessary data is captured

        // Capture headers from the page response
        page.on('response', async (response) => {
            if (response.url() === url && response.request().resourceType() === 'document') {
                const headers = response.headers();
                const status = response.status();
                const timing = response.timing();

                // Calculate DNS Lookup Time
                if (timing && timing.dnsEnd > -1 && timing.dnsStart > -1) {
                    dnsLookupTime = timing.dnsEnd - timing.dnsStart;
                    dnsLookupTime = Math.round(dnsLookupTime * 10000) / 10000;  // Round to 4 decimal places
                }

                if (timing) {
                    ttfb = timing.receiveHeadersStart - timing.sendEnd;
                }

                // Round off the TTFB to 4 decimal places
                ttfb = Math.round(ttfb * 10000) / 10000;

                console.log(`Status: ${status}`);
                console.log('CloudFront-Cache-Status:', headers['x-cache'] || 'N/A');
                console.log('Nitro-Cache-Status:', headers['x-nitro-cache'] || 'N/A');
                console.log('x-nitro-disabled:', headers['x-nitro-disabled'] || 'N/A');
                console.log('TTFB:', ttfb);

                let timestamp = new Date().toISOString();
                const data = {
                    timestamp,
                    url,
                    status,
                    cloudFrontCacheStatus: headers['x-cache'] || 'N/A',
                    nitroCacheStatus: headers['x-nitro-cache'] || 'N/A',
                    nitroDisabled: headers['x-nitro-disabled'] || 'N/A',
                    ttfb,
                    dnsLookupTime
                };

                csvData.push(data);
                dataCaptured = true; // Set flag to true when data is captured

                if (status === 200 && !headers['x-nitro-disabled']) {
                    if (headers['x-cache'] === 'Miss from cloudfront') {
                        cloudFrontCacheMiss.push(url);
                    }
                    if (headers['x-nitro-cache'] === 'MISS' || !headers['x-nitro-cache']) {
                        nitroCacheMiss.push(url);
                    }
                }
            }
        });

        // Navigate to the URL but limit wait time to 20 seconds without causing an error on timeout
        const navigationPromise = page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); // 2 minutes

        // Create a timeout promise for 20 seconds
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 20000));

        // Use Promise.race to wait for either page navigation or timeout, whichever comes first
        await Promise.race([navigationPromise, timeoutPromise]);

        // If data is not captured, retry the request
        if (!dataCaptured) {
            console.log(`Data not captured for URL: ${url} after 15 seconds. Retrying...`);

            if (retryCount < maxRetries) {
                await warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData, retryCount + 1);
            } else {
                console.error(`Failed to capture data for URL after ${maxRetries} attempts: ${url}`);
                logData.push(`Failed to capture data for URL after ${maxRetries} attempts: ${url}`);
            }
        }

    } catch (error) {
        console.error(`Error warming up URL: ${url}, Error: ${error.message}`);
        logData.push(`Error warming up URL: ${url}, Error: ${error.message}`);

        if (retryCount < maxRetries) {
            console.log(`Retrying URL: ${url}, Attempt: ${retryCount + 1}`);
            await warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData, retryCount + 1);
        } else {
            console.error(`Failed to warm up URL after ${maxRetries} attempts: ${url}`);
        }
    }
}


async function processUrlsSequentially(urls, logData, isGlobal = 0) {
    let browser;
    let page;
    try {
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-gpu', 
            ],
            headless: true
        });
        page = await browser.newPage();

        await page.setExtraHTTPHeaders({
            'X-Bot': 'Puppeteer'
        });
        await page.setUserAgent('Mozilla/5.0 (compatible; PuppeteerBot/1.0)');
        
        
        console.log(`Total URLs: ${urls.length}`);
        logData.push(`Total URLs: ${urls.length}`);
        logData.push(`Starting the warmup process for all URLs.`);
        await sendLogToSlack(logData);
        let urlChunks = chunkArray(urls, 500);
        let nitroCacheMiss = [];
        let cloudFrontCacheMiss = [];
        let cnt = 0;
        let csvData = [];

        for (const chunk of urlChunks) {
            for (const url of chunk) {
                cnt++;
                console.log(`Processing URL #${cnt}: ${url}`);
                try{
                    await warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData);
                }catch(e){
                    console.log(`Error warming up URL: ${url}, Error: ${e.message}`);
                    logData.push(`Error warming up URL: ${url}, Error: ${e.message}`);
                };
                await delay(100);
            }
            logData.push(`Processed ${cnt} URLs`);
            await sendLogToSlack(logData);
            await delay(120000); // 2 minutes
        }
        let filename ="";
        if(isGlobal === 1){
            filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_global_first_warmup_report`;
        }else if(isGlobal === 2){
            // sync sitemap
            filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_syncSitemap_first_warmup_report`;
        }else{
            filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_first_warmup_report`;
        }
        generateCSV(filename, csvData);
        logData.push(`Completed the first warmup process for all URLs.`);
        //share the url of csv generated in the public folder
        logData.push(`CSV file generated: ${process.env.WEB_URL}:${process.env.PORT}/public/reports/${filename}.csv`);
        await sendLogToSlack(logData);

        nitroCacheMiss = [...new Set(nitroCacheMiss)];
        if (nitroCacheMiss.length > 0) {
            console.log(`Processing Nitro Cache Miss URLs: ${nitroCacheMiss.length} URLs`);
            logData.push(`Processing Nitro Cache Miss URLs: ${nitroCacheMiss.length} URLs`);
            logData.push(`Waiting for 15 minutes before processing Nitro Cache Miss URLs`);
            await sendLogToSlack(logData);
            await delay(900000); // 15 minutes

            urlChunks = chunkArray(nitroCacheMiss, 500);
            cnt = 0;
            csvData = [];
            for (const chunk of urlChunks) {
                for (const url of chunk) {
                    cnt++;
                    console.log(`Retrying Nitro Cache Miss URL #${cnt}: ${url}`);
                    try{
                        await warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData);
                    }catch(e){
                        console.log(`Error warming up URL: ${url}, Error: ${e.message}`);
                        logData.push(`Error warming up URL: ${url}, Error: ${e.message}`);
                    };
                    await delay(100);
                }
                logData.push(`Processed ${cnt} URLs`);
                await sendLogToSlack(logData);
                //wait for 2 minutes
                await delay(120000); // 2 minutes
            }
            let filename ="";
            if(isGlobal === 1){
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_global_nitro_warmup_report`;
            }else if(isGlobal === 2){
                // sync sitemap
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_syncSitemap_nitro_warmup_report`;
            }else{
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_nitro_warmup_report`;
            }
            generateCSV(filename, csvData);
            logData.push(`Completed the nitro warmup process for all URLs.`);
            logData.push(`CSV file generated: ${process.env.WEB_URL}:${process.env.PORT}/public/reports/${filename}.csv`);
            await sendLogToSlack(logData);
        }

        cloudFrontCacheMiss = [...new Set(cloudFrontCacheMiss)];
        if (cloudFrontCacheMiss.length > 0) {
            console.log(`Processing CloudFront Cache Miss URLs: ${cloudFrontCacheMiss.length} URLs`);
            logData.push(`Processing CloudFront Cache Miss URLs: ${cloudFrontCacheMiss.length} URLs`);
            logData.push(`Waiting for 15 minutes before processing CloudFront Cache Miss URLs`);
            await sendLogToSlack(logData);
            await delay(900000); // 15 minutes

            urlChunks = chunkArray(cloudFrontCacheMiss, 500);
            cnt = 0;
            csvData = [];
            for (const chunk of urlChunks) {
                for (const url of chunk) {
                    cnt++;
                    console.log(`Retrying CloudFront Cache Miss URL #${cnt}: ${url}`);
                    try{
                        await warmupUrl(page, url, logData, nitroCacheMiss, cloudFrontCacheMiss, csvData);
                    }catch(e){
                        console.log(`Error warming up URL: ${url}, Error: ${e.message}`);
                        logData.push(`Error warming up URL: ${url}, Error: ${e.message}`);
                    };
                    await delay(100);
                }
                logData.push(`Processed ${cnt} URLs`);
                await sendLogToSlack(logData);
                //wait for 2 minutes
                await delay(120000); // 2 minutes
            }
            let filename ="";
            if(isGlobal === 1){
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_global_cloudfront_warmup_report`;
            }else if(isGlobal === 2){
                // sync sitemap
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_syncSitemap_cloudfront_warmup_report`;
            }else{
                filename = `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}_cloudfront_warmup_report`;
            }
            generateCSV(filename, csvData);
            logData.push(`Completed the cloudfront warmup process for all URLs.`);
            logData.push(`CSV file generated: ${process.env.WEB_URL}:${process.env.PORT}/public/reports/${filename}.csv`);
            await sendLogToSlack(logData);
        }

        logData.push(`Completed the warmup process for all URLs.`);

    } catch (error) {
        console.error(`Error processing the URLs: ${error.message}`);
        logData.push(`Error processing the URLs: ${error.message}`);
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

module.exports = { processUrlsSequentially };
