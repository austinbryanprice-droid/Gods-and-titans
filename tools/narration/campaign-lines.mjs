// Prints every line the campaign says (src/data/campaign.js) as JSON, for tools/narration/render.py --lines.
//   node tools/narration/campaign-lines.mjs > lines.json
import { campaignLines } from '../../src/data/campaign.js';

process.stdout.write(`${JSON.stringify(campaignLines(), null, 2)}\n`);
