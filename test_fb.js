const { execSync } = require('child_process');
const url = 'https://www.facebook.com/marketplace/search/?query=iphone';
try {
  const html = execSync(`curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" "${url}"`).toString();
  require('fs').writeFileSync('test_fb.html', html);
  console.log("wrote html");
} catch(e) {
  console.log(e);
}
