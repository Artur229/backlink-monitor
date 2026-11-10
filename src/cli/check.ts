import { checkLink } from "../lib/check/checkLink";

/** Debug: npm run check -- <donor_url> <target_url> [anchor] */
const [donorUrl, targetUrl, anchor] = process.argv.slice(2);
if (!donorUrl || !targetUrl) {
  console.error("Usage: npm run check -- <donor_url> <target_url> [anchor]");
  process.exit(2);
}
console.log(JSON.stringify(await checkLink({ donorUrl, targetUrl, anchor }), null, 2));
