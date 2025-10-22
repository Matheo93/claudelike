const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });

  await page.goto('https://docgenius.tech/og-image.html', {
    waitUntil: 'networkidle0'
  });

  await page.screenshot({
    path: path.join(__dirname, 'public', 'og-image.png'),
    type: 'png'
  });

  await browser.close();
  console.log('Screenshot saved to public/og-image.png');
})();
