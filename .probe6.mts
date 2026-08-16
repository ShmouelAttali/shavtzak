/** Print the working-tree engine's fit column for chosen rows. */
import fs from 'node:fs'; import path from 'node:path';
const t = fs.readFileSync(path.join('/Users/elyashiv/dev/ShmouelAttali/shavtzak/.claude/worktrees/ops-batch','apps-script/tools/ab-recommendations.mts'),'utf8');
console.log(t.split('\n').slice(0,60).join('\n'));
