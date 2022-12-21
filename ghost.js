const request = require('request');
const cheerio = require('cheerio');

// Set the URL you want to scrape
const url = 'https://www.example.com';

// Make the request to the URL
request(url, (error, response, html) => {
  if (!error && response.statusCode == 200) {
    // Load the HTML into cheerio
    const $ = cheerio.load(html);

    // Select the elements you want to scrape
    const title = $('title').text();
    const heading = $('h1').text();
    const paragraphs = $('p').map((i, element) => $(element).text()).get();

    // Print the scraped information
    console.log(title);
    console.log(heading);
    console.log(paragraphs);
  }
});
