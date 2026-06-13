// server/handlers/index.mjs — dispatch queue items to the right handler
import * as evaluateHandler from './evaluate.mjs';
import * as buildCvHandler from './build-cv.mjs';
import * as buildClHandler from './build-cl.mjs';
import * as onboardHandler from './onboard.mjs';
import * as commandHandler from './command.mjs';

export async function dispatch(request, generate) {
  const { kind, args = {} } = request;
  switch (kind) {
    case 'evaluate':   return evaluateHandler.handle(args, generate);
    case 'build-cv':   return buildCvHandler.handle(args, generate);
    case 'build-cl':   return buildClHandler.handle(args, generate);
    case 'onboard':    return onboardHandler.handle(args, generate);
    case 'command':    return commandHandler.handle(args, generate);
    case 'hunt':
      // hunt needs MCP or python-jobspy — fall back to jobspy
      throw new Error('hunt: run `npm run fetch` or `/cos hunt` in Claude Code (needs MCP or jobspy sidecar)');
    case 'apply':
      // apply requires human confirmation — cannot be autonomous
      throw new Error('apply: requires human confirmation — run `/cos apply` in Claude Code');
    default:
      throw new Error(`Unknown queue kind: ${kind}`);
  }
}
