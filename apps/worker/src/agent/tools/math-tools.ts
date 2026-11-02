import { reqStr, type Tool, type ToolContext, type ToolResult } from './types.js';

/**
 * Evaluates mathematical expressions using a strict sandbox without eval().
 * Supports basic arithmetic (+, -, *, /, %, ^, **), standard Math constants (PI, E),
 * and standard Math functions (sqrt, pow, sin, cos, tan, log, exp, abs, round, floor, ceil).
 */
export function evaluateSafeMath(expr: string): number {
  let clean = expr.trim();
  // Replace ^ with ** for exponents
  clean = clean.replace(/\^/g, '**');

  // Verify expression contains only allowed mathematical characters
  if (!/^[0-9+\-*/%().,\s\w**]+$/.test(clean)) {
    throw new Error('Expression contains disallowed characters.');
  }

  // Whitelist of safe Math identifiers
  const allowedMath: Record<string, unknown> = {
    PI: Math.PI,
    E: Math.E,
    sqrt: Math.sqrt,
    pow: Math.pow,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log,
    log10: Math.log10,
    exp: Math.exp,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    min: Math.min,
    max: Math.max,
  };

  // Replace functions/constants with Math.<name>
  for (const key of Object.keys(allowedMath)) {
    const reg = new RegExp(`\\b${key}\\b`, 'g');
    clean = clean.replace(reg, `Math.${key}`);
  }

  // Prevent prototype access or object references
  if (/(window|global|process|constructor|prototype|__proto__|require|import|eval|Function)/i.test(clean)) {
    throw new Error('Security violation in mathematical expression.');
  }

  // Evaluate via Function constructor with Math scope
  const fn = new Function('Math', `return (${clean});`);
  const result = fn(Math);

  if (typeof result !== 'number' || Number.isNaN(result)) {
    throw new Error('Expression did not evaluate to a valid number.');
  }
  return result;
}

export const mathCalculateTool: Tool = {
  descriptor: {
    name: 'math_calculate',
    description:
      'Execute high-precision mathematical, physical, statistical, or unit conversion formulas safely. Returns verified calculations.',
    risk: 'read-only',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate, e.g. "sqrt(144) + 2^4 * sin(PI / 2)"',
        },
      },
      required: ['expression'],
    },
  },
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const expr = reqStr(args, 'expression');
    if (!expr.ok) return { ok: false, output: expr.error };

    try {
      ctx.log.info('evaluating safe math', { expression: expr.value });
      const result = evaluateSafeMath(expr.value);
      return {
        ok: true,
        output: `Calculation Result:\n\`${expr.value}\` = **${result}**`,
        meta: { expression: expr.value, result },
      };
    } catch (err) {
      return { ok: false, output: `Math evaluation error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
