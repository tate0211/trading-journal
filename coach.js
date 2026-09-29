// AI coach: sends a summary of your journal to Claude and streams back a review.
const Coach = (() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
  const MODEL = 'claude-opus-5';
  let sdk;

  const SYSTEM = `You are a trading performance coach reviewing a discretionary trader's journal.
The trader trades forex, indices/futures and stocks/options. Your job is process coaching: discipline, rule adherence, risk management, psychology and execution quality. Do not give buy/sell calls, price predictions or personalised investment advice.

Ground every claim in the data you are given. Quote specific trades by date and instrument. Where a pattern rests on only a few trades, say so. Measure outcomes in R (multiples of initial risk) first and currency second.

Be direct and specific, like a good coach who wants the trader to improve. Praise what is genuinely working, and name the costliest leak plainly.

Format the answer in Markdown with these sections:
## Summary
## What's working
## Biggest leaks
(rank by R lost; tie each to the rule or mistake tag involved)
## Patterns I noticed
(time of day, session, setup, emotions, sequences such as a loss followed by an oversized trade, overtrading, etc.)
## Your focus for next period
(exactly 3 concrete, measurable actions, plus the ONE rule to protect above all)`;

  async function client(apiKey) {
    if (!sdk) sdk = await import(SDK_URL);
    const Anthropic = sdk.default;
    // The key lives only in this browser; requests go straight to Anthropic.
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  // messages: Anthropic message params. onText receives streamed text deltas.
  // system: optional override of the coaching instructions (used by the news explainer).
  async function run({ apiKey, messages, onText, system = SYSTEM }) {
    const c = await client(apiKey);
    const stream = c.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system,
      messages,
      // If Opus 5's safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    stream.on('text', (t) => onText && onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      throw new Error('Claude declined this request' + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'));
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, content: msg.content, stopReason: msg.stop_reason };
  }

  function explainError(err) {
    if (!sdk) return 'Could not load the Anthropic SDK. Check your internet connection.';
    const A = sdk.default;
    if (err instanceof A.AuthenticationError) return 'Your API key was rejected. Check it in Settings.';
    if (err instanceof A.PermissionDeniedError) return 'This API key does not have permission to use this model.';
    if (err instanceof A.RateLimitError) return 'Rate limited. Wait a minute and try again.';
    if (err instanceof A.BadRequestError) return 'The request was rejected: ' + err.message;
    if (err instanceof A.APIConnectionError) return 'Could not reach the Anthropic API. Check your connection.';
    if (err instanceof A.APIError) return `Anthropic API error (${err.status}): ${err.message}`;
    return err.message || String(err);
  }

  return { run, explainError, MODEL };
})();
